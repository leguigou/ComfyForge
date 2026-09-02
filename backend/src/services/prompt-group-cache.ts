import db from './database';
import {
  getPromptGroupingIdentity,
  groupItemsByPrompt,
  groupItemsByPromptAsync,
  normalizePromptGroupingSettings,
  promptSimilarityPercent,
  type PromptGroupingItem,
  type PromptGroupingSettings,
} from './prompt-grouping';

const CACHE_ALGORITHM_VERSION = 2;
const STARTUP_SYNC_REBUILD_MAX_ITEMS = 1_000;

interface CachedPromptRow {
  messageId: string;
  groupId: string;
  normalizedPrompt: string;
  wordCount: number;
}

interface StoredPromptItem extends PromptGroupingItem {
  messageId: string;
  userId: string;
  manualGroupId?: string | null;
}

export interface PromptGroupRebuildStatus {
  status: 'idle' | 'dirty' | 'running' | 'complete' | 'error';
  processedPhotos: number;
  totalPhotos: number;
  groupsFormed: number;
  percent: number;
  manualGroupsPreserved: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  needsRebuild: boolean;
}

const rebuildJobs = new Map<string, PromptGroupRebuildStatus>();
const cacheRevisions = new Map<string, number>();
const bumpCacheRevision = (userId: string) => {
  const revision = (cacheRevisions.get(userId) || 0) + 1;
  cacheRevisions.set(userId, revision);
  return revision;
};

export const promptGroupingSettingsHash = (settings: PromptGroupingSettings) => (
  `v${CACHE_ALGORITHM_VERSION}:${settings.minWords}:${settings.similarity}`
);

export const getPromptGroupingSettingsForUser = (userId: string): PromptGroupingSettings => {
  const userSettings = db.prepare('SELECT data FROM user_settings WHERE userId = ?').get(userId) as { data: string } | undefined;
  const globalSettings = db.prepare('SELECT data FROM settings WHERE id = 1').get() as { data: string } | undefined;
  try {
    return normalizePromptGroupingSettings(JSON.parse((userSettings || globalSettings)?.data || '{}'));
  } catch {
    return normalizePromptGroupingSettings();
  }
};

const markCacheReady = (userId: string, settingsHash: string) => {
  db.prepare(`
    INSERT INTO prompt_group_cache_state (userId, settingsHash, status, updatedAt)
    VALUES (?, ?, 'ready', ?)
    ON CONFLICT(userId) DO UPDATE SET
      settingsHash = excluded.settingsHash,
      status = 'ready',
      updatedAt = excluded.updatedAt
  `).run(userId, settingsHash, Date.now());
};

const prepareCacheEntryUpsert = () => db.prepare(`
  INSERT INTO prompt_group_cache (
    messageId, userId, groupId, promptKind, normalizedPrompt,
    wordCount, settingsHash, updatedAt
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(messageId) DO UPDATE SET
    userId = excluded.userId,
    groupId = excluded.groupId,
    promptKind = excluded.promptKind,
    normalizedPrompt = excluded.normalizedPrompt,
    wordCount = excluded.wordCount,
    settingsHash = excluded.settingsHash,
    updatedAt = excluded.updatedAt
`);

const insertPromptGroupSummaries = (userId: string, groupIds?: string[]) => {
  if (groupIds && groupIds.length === 0) return;
  const groupFilter = groupIds?.length
    ? `AND pgc.groupId IN (${groupIds.map(() => '?').join(',')})`
    : '';
  db.prepare(`
    WITH ranked AS (
      SELECT s.userId, s.isArchived, pgc.groupId, m.id AS messageId,
        m.timestamp, COALESCE(m.isFavorite, 0) AS isFavorite,
        COALESCE(m.isPromptFavorite, 0) AS isPromptFavorite,
        ROW_NUMBER() OVER (
          PARTITION BY s.userId, s.isArchived, pgc.groupId
          ORDER BY COALESCE(m.isGroupCover, 0) DESC, m.timestamp DESC, m.id DESC
        ) AS representativeRank
      FROM messages m
      JOIN sessions s ON s.id = m.sessionId
      JOIN prompt_group_cache pgc ON pgc.messageId = m.id AND pgc.userId = s.userId
      WHERE s.userId = ? AND m.imageUrl IS NOT NULL ${groupFilter}
    )
    INSERT INTO prompt_group_summary (
      userId, isArchived, groupId, representativeMessageId, groupCount,
      groupHasFavorite, groupHasPromptFavorite, groupTimestamp, updatedAt
    )
    SELECT userId, isArchived, groupId,
      MAX(CASE WHEN representativeRank = 1 THEN messageId END),
      COUNT(*), MAX(isFavorite), MAX(isPromptFavorite), MAX(timestamp), ?
    FROM ranked
    GROUP BY userId, isArchived, groupId
  `).run(userId, ...(groupIds || []), Date.now());
};

export const rebuildPromptGroupSummariesForUser = (userId: string) => {
  const settingsHash = promptGroupingSettingsHash(getPromptGroupingSettingsForUser(userId));
  db.transaction(() => {
    db.prepare('DELETE FROM prompt_group_summary WHERE userId = ?').run(userId);
    insertPromptGroupSummaries(userId);
    db.prepare(`
      INSERT INTO prompt_group_summary_state (userId, settingsHash, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET
        settingsHash = excluded.settingsHash,
        updatedAt = excluded.updatedAt
    `).run(userId, settingsHash, Date.now());
  })();
};

const refreshPromptGroupSummaries = (userId: string, groupIds: string[]) => {
  const uniqueGroupIds = [...new Set(groupIds.filter(Boolean))];
  if (uniqueGroupIds.length === 0) return;
  const placeholders = uniqueGroupIds.map(() => '?').join(',');
  db.transaction(() => {
    db.prepare(`
      DELETE FROM prompt_group_summary WHERE userId = ? AND groupId IN (${placeholders})
    `).run(userId, ...uniqueGroupIds);
    insertPromptGroupSummaries(userId, uniqueGroupIds);
  })();
};

export const refreshPromptGroupSummariesForMessage = (messageId: string) => {
  const cached = db.prepare(`
    SELECT pgc.userId, pgc.groupId
    FROM prompt_group_cache pgc
    WHERE pgc.messageId = ?
  `).get(messageId) as { userId: string; groupId: string } | undefined;
  if (cached) refreshPromptGroupSummaries(cached.userId, [cached.groupId]);
};

export const isPromptGroupSummaryReady = (userId: string) => {
  const settingsHash = promptGroupingSettingsHash(getPromptGroupingSettingsForUser(userId));
  const state = db.prepare(`
    SELECT settingsHash FROM prompt_group_summary_state WHERE userId = ?
  `).get(userId) as { settingsHash: string } | undefined;
  return state?.settingsHash === settingsHash;
};

const loadPromptItemsForUser = (userId: string) => db.prepare(`
  SELECT m.id AS messageId, s.userId, m.prompt, m.generationPrompt, m.text,
    m.randomSelections, m.manualGroupId, m.timestamp, m.isGroupCover,
    m.isFavorite, m.isPromptFavorite
  FROM messages m
  JOIN sessions s ON s.id = m.sessionId
  WHERE s.userId = ? AND m.imageUrl IS NOT NULL
`).all(userId) as StoredPromptItem[];

const persistPromptGroups = (
  userId: string,
  settingsHash: string,
  groups: ReturnType<typeof groupItemsByPrompt<StoredPromptItem>>,
) => {
  const refreshedAt = Date.now();
  const upsertCacheEntry = prepareCacheEntryUpsert();
  db.transaction(() => {
    db.prepare('DELETE FROM prompt_group_cache WHERE userId = ?').run(userId);
    for (const group of groups) {
      const automaticId = [...group.items]
        .map(item => item.messageId)
        .sort((left, right) => left.localeCompare(right))[0];
      for (const item of group.items) {
        const manualGroupId = typeof item.manualGroupId === 'string' ? item.manualGroupId.trim() : '';
        const identity = getPromptGroupingIdentity(item);
        upsertCacheEntry.run(
          item.messageId,
          userId,
          manualGroupId ? `manual:${manualGroupId}` : `auto:${automaticId}`,
          manualGroupId ? 'manual' : identity.kind,
          manualGroupId || identity.normalized,
          manualGroupId ? 0 : identity.wordCount,
          settingsHash,
          refreshedAt,
        );
      }
    }
    markCacheReady(userId, settingsHash);
  })();
  rebuildPromptGroupSummariesForUser(userId);
};

export const rebuildPromptGroupCacheForUser = (
  userId: string,
  settings = getPromptGroupingSettingsForUser(userId),
) => {
  bumpCacheRevision(userId);
  if (rebuildJobs.get(userId)?.status !== 'running') rebuildJobs.delete(userId);
  const startedAt = Date.now();
  const settingsHash = promptGroupingSettingsHash(settings);
  const items = loadPromptItemsForUser(userId);
  const groups = groupItemsByPrompt(items, settings);
  persistPromptGroups(userId, settingsHash, groups);

  return { groups: groups.length, items: items.length, durationMs: Date.now() - startedAt, settingsHash };
};

const cacheSummaryForUser = (userId: string) => db.prepare(`
  SELECT
    COUNT(*) AS totalPhotos,
    COUNT(DISTINCT pgc.groupId) AS groupsFormed,
    COUNT(DISTINCT CASE WHEN m.manualGroupId IS NOT NULL THEN m.manualGroupId END) AS manualGroupsPreserved
  FROM messages m
  JOIN sessions s ON s.id = m.sessionId
  LEFT JOIN prompt_group_cache pgc ON pgc.messageId = m.id AND pgc.userId = s.userId
  WHERE s.userId = ? AND m.imageUrl IS NOT NULL
`).get(userId) as { totalPhotos: number; groupsFormed: number; manualGroupsPreserved: number };

export const getPromptGroupRebuildStatus = (userId: string): PromptGroupRebuildStatus => {
  const running = rebuildJobs.get(userId);
  if (running) return { ...running };
  const settingsHash = promptGroupingSettingsHash(getPromptGroupingSettingsForUser(userId));
  const state = db.prepare(`
    SELECT settingsHash, status FROM prompt_group_cache_state WHERE userId = ?
  `).get(userId) as { settingsHash: string; status: string } | undefined;
  const summary = cacheSummaryForUser(userId);
  const needsRebuild = state?.settingsHash !== settingsHash || state?.status === 'dirty';
  return {
    status: needsRebuild ? 'dirty' : 'idle',
    processedPhotos: summary.totalPhotos,
    totalPhotos: summary.totalPhotos,
    groupsFormed: summary.groupsFormed,
    percent: summary.totalPhotos > 0 ? 100 : 0,
    manualGroupsPreserved: summary.manualGroupsPreserved,
    needsRebuild,
  };
};

export const markPromptGroupCacheDirtyForUser = (userId: string) => {
  const desiredHash = promptGroupingSettingsHash(getPromptGroupingSettingsForUser(userId));
  const state = db.prepare(`SELECT settingsHash, status FROM prompt_group_cache_state WHERE userId = ?`).get(userId) as
    { settingsHash: string; status: string } | undefined;
  if (state?.settingsHash === desiredHash && state.status === 'ready') return false;
  bumpCacheRevision(userId);
  db.prepare(`
    INSERT INTO prompt_group_cache_state (userId, settingsHash, status, updatedAt)
    VALUES (?, COALESCE((SELECT settingsHash FROM prompt_group_cache_state WHERE userId = ?), ''), 'dirty', ?)
    ON CONFLICT(userId) DO UPDATE SET status = 'dirty', updatedAt = excluded.updatedAt
  `).run(userId, userId, Date.now());
  if (rebuildJobs.get(userId)?.status !== 'running') rebuildJobs.delete(userId);
  return true;
};

export const startPromptGroupCacheRebuild = (userId: string) => {
  const existing = rebuildJobs.get(userId);
  if (existing?.status === 'running') return { ...existing };

  const settings = getPromptGroupingSettingsForUser(userId);
  const settingsHash = promptGroupingSettingsHash(settings);
  const items = loadPromptItemsForUser(userId);
  const manualGroupsPreserved = new Set(items
    .map(item => typeof item.manualGroupId === 'string' ? item.manualGroupId.trim() : '')
    .filter(Boolean)).size;
  const startedAt = Date.now();
  const rebuildRevision = cacheRevisions.get(userId) || 0;
  const status: PromptGroupRebuildStatus = {
    status: 'running',
    processedPhotos: 0,
    totalPhotos: items.length,
    groupsFormed: 0,
    percent: items.length > 0 ? 0 : 100,
    manualGroupsPreserved,
    startedAt,
    needsRebuild: true,
  };
  rebuildJobs.set(userId, status);
  db.prepare(`UPDATE prompt_group_cache_state SET status = 'building', updatedAt = ? WHERE userId = ?`)
    .run(startedAt, userId);

  void (async () => {
    try {
      const yieldEvery = items.length > STARTUP_SYNC_REBUILD_MAX_ITEMS ? 1 : 20;
      const groups = await groupItemsByPromptAsync(items, settings, progress => {
        status.processedPhotos = progress.processed;
        status.totalPhotos = progress.total;
        status.groupsFormed = progress.groups;
        status.percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 100;
      }, yieldEvery);
      if ((cacheRevisions.get(userId) || 0) !== rebuildRevision) {
        rebuildJobs.delete(userId);
        startPromptGroupCacheRebuild(userId);
        return;
      }
      persistPromptGroups(userId, settingsHash, groups);
      status.status = 'complete';
      status.processedPhotos = items.length;
      status.totalPhotos = items.length;
      status.groupsFormed = groups.length;
      status.percent = 100;
      status.completedAt = Date.now();
      status.needsRebuild = promptGroupingSettingsHash(getPromptGroupingSettingsForUser(userId)) !== settingsHash;
      if (status.needsRebuild) {
        db.prepare(`UPDATE prompt_group_cache_state SET status = 'dirty', updatedAt = ? WHERE userId = ?`)
          .run(status.completedAt, userId);
      }
      console.log(`[Prompt groups] Cached ${items.length} images in ${status.completedAt - startedAt} ms`);
    } catch (error) {
      status.status = 'error';
      status.error = error instanceof Error ? error.message : String(error);
      status.completedAt = Date.now();
      db.prepare(`UPDATE prompt_group_cache_state SET status = 'dirty', updatedAt = ? WHERE userId = ?`)
        .run(status.completedAt, userId);
      console.error(`[Prompt groups] Background rebuild failed for user ${userId}:`, error);
    }
  })();
  return { ...status };
};

export const refreshPromptGroupCacheForMessage = (messageId: string) => {
  const previousCache = db.prepare(`
    SELECT userId, groupId FROM prompt_group_cache WHERE messageId = ?
  `).get(messageId) as { userId: string; groupId: string } | undefined;
  const item = db.prepare(`
    SELECT m.id AS messageId, s.userId, m.prompt, m.generationPrompt, m.text,
      m.randomSelections, m.manualGroupId, m.timestamp, m.isGroupCover,
      m.isFavorite, m.isPromptFavorite, m.imageUrl
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE m.id = ?
  `).get(messageId) as (StoredPromptItem & { imageUrl?: string | null }) | undefined;

  if (!item?.imageUrl) {
    db.prepare('DELETE FROM prompt_group_cache WHERE messageId = ?').run(messageId);
    if (previousCache) refreshPromptGroupSummaries(previousCache.userId, [previousCache.groupId]);
    return null;
  }

  bumpCacheRevision(item.userId);

  const settings = getPromptGroupingSettingsForUser(item.userId);
  const settingsHash = promptGroupingSettingsHash(settings);
  const identity = getPromptGroupingIdentity(item);
  const compatiblePromptKinds = identity.kind === 'message' ? ['message'] : ['dynamic', 'prompt'];
  const compatiblePromptKindSql = compatiblePromptKinds.map(() => '?').join(', ');
  const manualGroupId = typeof item.manualGroupId === 'string' ? item.manualGroupId.trim() : '';
  let groupId = manualGroupId ? `manual:${manualGroupId}` : '';

  if (!groupId) {
    const exact = db.prepare(`
      SELECT groupId
      FROM prompt_group_cache
      WHERE userId = ? AND settingsHash = ? AND promptKind IN (${compatiblePromptKindSql})
        AND normalizedPrompt = ? AND messageId <> ?
      ORDER BY groupId
      LIMIT 1
    `).get(item.userId, settingsHash, ...compatiblePromptKinds, identity.normalized, messageId) as { groupId: string } | undefined;
    groupId = exact?.groupId || '';
  }

  if (!groupId && identity.kind !== 'message' && identity.wordCount >= settings.minWords) {
    const threshold = settings.similarity / 100;
    const minimumWords = Math.max(settings.minWords, Math.ceil(identity.wordCount * threshold));
    const maximumWords = Math.floor(identity.wordCount / threshold);
    const candidates = db.prepare(`
      SELECT messageId, groupId, normalizedPrompt, wordCount
      FROM prompt_group_cache
      WHERE userId = ? AND settingsHash = ? AND promptKind IN (${compatiblePromptKindSql})
        AND wordCount BETWEEN ? AND ? AND messageId <> ?
    `).all(
      item.userId,
      settingsHash,
      ...compatiblePromptKinds,
      minimumWords,
      maximumWords,
      messageId,
    ) as CachedPromptRow[];
    const candidatesByGroup = new Map<string, CachedPromptRow[]>();
    for (const candidate of candidates) {
      const rows = candidatesByGroup.get(candidate.groupId) || [];
      rows.push(candidate);
      candidatesByGroup.set(candidate.groupId, rows);
    }
    let bestScore = -1;
    for (const [candidateGroupId, rows] of candidatesByGroup) {
      const prompts = [...new Set(rows.map(row => row.normalizedPrompt))];
      const scores = prompts.map(prompt => promptSimilarityPercent(identity.normalized, prompt));
      if (scores.some(score => score < settings.similarity)) continue;
      const score = Math.min(...scores);
      if (score > bestScore || (score === bestScore && candidateGroupId < groupId)) {
        bestScore = score;
        groupId = candidateGroupId;
      }
    }
  }

  if (!groupId) groupId = `auto:${messageId}`;
  const upsertCacheEntry = prepareCacheEntryUpsert();
  db.transaction(() => {
    upsertCacheEntry.run(
      messageId,
      item.userId,
      groupId,
      manualGroupId ? 'manual' : identity.kind,
      manualGroupId || identity.normalized,
      manualGroupId ? 0 : identity.wordCount,
      settingsHash,
      Date.now(),
    );
    markCacheReady(item.userId, settingsHash);
  })();
  refreshPromptGroupSummaries(item.userId, [previousCache?.groupId || '', groupId]);
  return { groupId, settingsHash };
};

export const ensurePromptGroupCacheForUser = (userId: string) => {
  const settings = getPromptGroupingSettingsForUser(userId);
  const settingsHash = promptGroupingSettingsHash(settings);
  const state = db.prepare(`
    SELECT settingsHash, status FROM prompt_group_cache_state WHERE userId = ?
  `).get(userId) as { settingsHash: string; status: string } | undefined;
  if (state?.settingsHash === settingsHash && state.status === 'ready') return null;
  return rebuildPromptGroupCacheForUser(userId, settings);
};

export const initializePromptGroupCaches = () => {
  const users = db.prepare(`
    SELECT u.id, COUNT(m.id) AS imageCount
    FROM users u
    LEFT JOIN sessions s ON s.userId = u.id
    LEFT JOIN messages m ON m.sessionId = s.id AND m.imageUrl IS NOT NULL
    GROUP BY u.id
    ORDER BY u.createdAt, u.id
  `).all() as Array<{ id: string; imageCount: number }>;
  const rebuildUsers: Array<{ id: string; imageCount: number }> = [];
  const summaryUsers: string[] = [];

  for (const user of users) {
    const settingsHash = promptGroupingSettingsHash(getPromptGroupingSettingsForUser(user.id));
    const state = db.prepare(`
      SELECT settingsHash, status FROM prompt_group_cache_state WHERE userId = ?
    `).get(user.id) as { settingsHash: string; status: string } | undefined;
    if (state?.settingsHash === settingsHash && state.status === 'ready') {
      if (!isPromptGroupSummaryReady(user.id)) summaryUsers.push(user.id);
      continue;
    }
    rebuildUsers.push(user);
  }

  if (rebuildUsers.length || summaryUsers.length) {
    const totalItems = rebuildUsers.reduce((sum, user) => sum + user.imageCount, 0);
    console.log(`[Prompt groups] Scheduling ${totalItems} images and ${summaryUsers.length} summaries for background maintenance`);
    setImmediate(() => {
      summaryUsers.forEach(rebuildPromptGroupSummariesForUser);
      rebuildUsers.forEach(user => startPromptGroupCacheRebuild(user.id));
    });
  }
  return [];
};
