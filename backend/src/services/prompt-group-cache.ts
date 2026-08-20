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

const CACHE_ALGORITHM_VERSION = 1;

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
      const groups = await groupItemsByPromptAsync(items, settings, progress => {
        status.processedPhotos = progress.processed;
        status.totalPhotos = progress.total;
        status.groupsFormed = progress.groups;
        status.percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 100;
      });
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
    } catch (error) {
      status.status = 'error';
      status.error = error instanceof Error ? error.message : String(error);
      status.completedAt = Date.now();
      db.prepare(`UPDATE prompt_group_cache_state SET status = 'dirty', updatedAt = ? WHERE userId = ?`)
        .run(status.completedAt, userId);
    }
  })();
  return { ...status };
};

export const refreshPromptGroupCacheForMessage = (messageId: string) => {
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
    return null;
  }

  bumpCacheRevision(item.userId);

  const settings = getPromptGroupingSettingsForUser(item.userId);
  const settingsHash = promptGroupingSettingsHash(settings);
  const identity = getPromptGroupingIdentity(item);
  const manualGroupId = typeof item.manualGroupId === 'string' ? item.manualGroupId.trim() : '';
  let groupId = manualGroupId ? `manual:${manualGroupId}` : '';

  if (!groupId) {
    const exact = db.prepare(`
      SELECT groupId
      FROM prompt_group_cache
      WHERE userId = ? AND settingsHash = ? AND promptKind = ?
        AND normalizedPrompt = ? AND messageId <> ?
      ORDER BY groupId
      LIMIT 1
    `).get(item.userId, settingsHash, identity.kind, identity.normalized, messageId) as { groupId: string } | undefined;
    groupId = exact?.groupId || '';
  }

  if (!groupId && identity.kind !== 'message' && identity.wordCount >= settings.minWords) {
    const threshold = settings.similarity / 100;
    const minimumWords = Math.max(settings.minWords, Math.ceil(identity.wordCount * threshold));
    const maximumWords = Math.floor(identity.wordCount / threshold);
    const candidates = db.prepare(`
      SELECT messageId, groupId, normalizedPrompt, wordCount
      FROM prompt_group_cache
      WHERE userId = ? AND settingsHash = ? AND promptKind = ?
        AND wordCount BETWEEN ? AND ? AND messageId <> ?
    `).all(
      item.userId,
      settingsHash,
      identity.kind,
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
  const users = db.prepare('SELECT id FROM users ORDER BY createdAt, id').all() as Array<{ id: string }>;
  const results = users.map(user => ensurePromptGroupCacheForUser(user.id)).filter(Boolean);
  if (results.length) {
    const totalItems = results.reduce((sum, result) => sum + (result?.items || 0), 0);
    const totalDuration = results.reduce((sum, result) => sum + (result?.durationMs || 0), 0);
    console.log(`[Prompt groups] Cached ${totalItems} images in ${totalDuration} ms`);
  }
  return results;
};
