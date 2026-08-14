import express from 'express';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import db from '../services/database';
import { authenticate } from '../middleware/auth';
import { withParsedRandomSelections } from '../services/message-metadata';
import { attachPromptTags } from '../services/prompt-tags';
import { imagesDir } from '../services/image';
import { buildCivitaiGenerationData, embedCivitaiMetadataInWebp } from '../services/civitai-metadata';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

const getRequestedSessionId = (req: express.Request) => (
  typeof req.query.sessionId === 'string' ? req.query.sessionId.trim().slice(0, 200) : ''
);

const getMultiQueryValues = (value: unknown, maxItems = 50) => {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().slice(0, 300))
    .filter(Boolean))].slice(0, maxItems);
};

const effectivePromptSql = (messageAlias = 'm') => `CASE
  WHEN NULLIF(TRIM(${messageAlias}.prompt), '') IS NOT NULL
    AND CASE
      WHEN json_valid(${messageAlias}.randomSelections)
        THEN json_array_length(${messageAlias}.randomSelections)
      ELSE 0
    END > 0
    THEN '__dynamic__:' || TRIM(${messageAlias}.prompt)
  ELSE COALESCE(
    NULLIF(TRIM(${messageAlias}.generationPrompt), ''),
    NULLIF(TRIM(${messageAlias}.prompt), ''),
    NULLIF(TRIM(${messageAlias}.text), ''),
    '__message__:' || ${messageAlias}.id
  )
END`;

const galleryGroupKeySql = (messageAlias = 'm') => `CASE
  WHEN NULLIF(TRIM(${messageAlias}.manualGroupId), '') IS NOT NULL
    THEN '__manual__:' || TRIM(${messageAlias}.manualGroupId)
  ELSE '__prompt__:' || (${effectivePromptSql(messageAlias)})
END`;

const galleryColumnsSql = (messageAlias = 'm') => `
  ${messageAlias}.sessionId, ${messageAlias}.id as messageId, ${messageAlias}.imageUrl,
  ${messageAlias}.thumbnailUrl, ${messageAlias}.prompt, ${messageAlias}.text,
  ${messageAlias}.generationPrompt, ${messageAlias}.timestamp, ${messageAlias}.model,
  ${messageAlias}.width, ${messageAlias}.height, ${messageAlias}.steps, ${messageAlias}.cfg,
  ${messageAlias}.workflow, ${messageAlias}.seed, ${messageAlias}.isFavorite,
  ${messageAlias}.isPromptFavorite, ${messageAlias}.isGroupCover,
  ${messageAlias}.manualGroupId,
  ${messageAlias}.duration, ${messageAlias}.sampler,
  ${messageAlias}.scheduler, ${messageAlias}.randomSelections,
  ${messageAlias}.comparisonMessageId
`;

interface StoredCivitaiModelLink {
  localModel?: string;
  modelType?: 'checkpoint' | 'diffusion';
  modelName?: string;
  versionName?: string;
  air?: string;
  autoV2?: string;
  sha256?: string;
}

const getCivitaiSettingsForUser = (userId: string) => {
  const userSettings = db.prepare('SELECT data FROM user_settings WHERE userId = ?').get(userId) as { data: string } | undefined;
  const globalSettings = db.prepare('SELECT data FROM settings WHERE id = 1').get() as { data: string } | undefined;
  const stored = userSettings || globalSettings;
  if (!stored) return { enabled: false, links: [] as StoredCivitaiModelLink[] };
  try {
    const parsed = JSON.parse(stored.data);
    return {
      enabled: parsed?.civitaiMetadataOnDownload === true,
      links: Array.isArray(parsed?.civitaiModelLinks) ? parsed.civitaiModelLinks as StoredCivitaiModelLink[] : [],
    };
  } catch {
    return { enabled: false, links: [] as StoredCivitaiModelLink[] };
  }
};

const normalizedModelKey = (value: unknown) => typeof value === 'string'
  ? path.basename(value.replace(/\\/g, '/')).toLowerCase()
  : '';

const resolveDownloadImagePath = (userId: string, imageUrl: string) => {
  const prefix = '/api/image-files/';
  const pathname = imageUrl.split(/[?#]/, 1)[0];
  if (!pathname.startsWith(prefix)) return null;

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }

  const normalizedParts = relativePath.split('/').filter(Boolean);
  const isUserScoped = normalizedParts.length === 2 && normalizedParts[0] === userId;
  const isLegacy = normalizedParts.length === 1;
  if ((!isUserScoped && !isLegacy) || normalizedParts.includes('..')) return null;

  const resolvedRoot = path.resolve(imagesDir);
  const resolvedPath = path.resolve(resolvedRoot, ...normalizedParts);
  const relativeToRoot = path.relative(resolvedRoot, resolvedPath);
  if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return null;
  return resolvedPath;
};

router.get('/download/:messageId', authenticate, async (req, res) => {
  const user = (req as any).user;
  const message = db.prepare(`
    SELECT m.id, m.text, m.prompt, m.generationPrompt, m.imageUrl, m.model,
      m.width, m.height, m.steps, m.cfg, m.seed, m.sampler, m.scheduler,
      m.generationParams
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE m.id = ? AND s.userId = ? AND m.imageUrl IS NOT NULL
  `).get(req.params.messageId, user.id) as Record<string, unknown> | undefined;

  if (!message || typeof message.imageUrl !== 'string') {
    return res.status(404).json({ error: 'Gallery image not found' });
  }

  const imagePath = resolveDownloadImagePath(user.id, message.imageUrl);
  if (!imagePath || path.extname(imagePath).toLowerCase() !== '.webp') {
    return res.status(404).json({ error: 'Downloadable image not found' });
  }

  try {
    const source = await fs.promises.readFile(imagePath);
    let download = source;
    const civitaiSettings = getCivitaiSettingsForUser(user.id);
    if (civitaiSettings.enabled) {
      const metadata = await sharp(source).metadata();
      if (!metadata.width || !metadata.height) throw new Error('Unable to read image dimensions');
      let generationParams: Record<string, unknown> = {};
      if (typeof message.generationParams === 'string') {
        try { generationParams = JSON.parse(message.generationParams || '{}') as Record<string, unknown>; } catch { /* legacy row */ }
      }
      const modelName = typeof message.model === 'string' ? message.model : generationParams.comfyModel;
      const modelType = generationParams.comfyModelType === 'diffusion' ? 'diffusion' : 'checkpoint';
      const resource = civitaiSettings.links.find(link => (
        normalizedModelKey(link.localModel) === normalizedModelKey(modelName)
        && (link.modelType || 'checkpoint') === modelType
      ));
      const generationData = buildCivitaiGenerationData(message, {
        width: metadata.width,
        height: metadata.height,
      }, resource);
      download = Buffer.from(embedCivitaiMetadataInWebp(source, generationData, {
        width: metadata.width,
        height: metadata.height,
      }));
    }

    const safeMessageId = String(message.id).replace(/[^a-zA-Z0-9_-]+/g, '_');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'image/webp');
    res.attachment(`img-${safeMessageId}.webp`);
    return res.send(download);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return res.status(404).json({ error: 'Downloadable image not found' });
    console.error('[Gallery] Failed to prepare image download:', error);
    return res.status(500).json({ error: 'Unable to prepare image download' });
  }
});

router.get('/tags', authenticate, (req, res) => {
  const user = (req as any).user;
  const sessionId = getRequestedSessionId(req);
  const tags = db.prepare(`
    SELECT t.id AS slug, t.category, t.labelFr, t.labelEn, COUNT(DISTINCT mt.messageId) AS count
    FROM tags t
    JOIN message_tags mt ON mt.tagId = t.id
    JOIN messages m ON m.id = mt.messageId
    JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ? AND m.imageUrl IS NOT NULL
      ${sessionId ? 'AND s.id = ?' : ''}
    GROUP BY t.id, t.category, t.labelFr, t.labelEn
    ORDER BY count DESC, t.labelFr ASC
  `).all(user.id, ...(sessionId ? [sessionId] : []));
  res.json(tags);
});

router.get('/filters', authenticate, (req, res) => {
  const user = (req as any).user;
  const sessionId = getRequestedSessionId(req);
  const onlyArchived = req.query.includeArchived === 'true';
  const scopeSql = sessionId ? 'AND s.id = ?' : 'AND s.isArchived = ?';
  const scopeParams = sessionId ? [user.id, sessionId] : [user.id, onlyArchived ? 1 : 0];
  const baseSql = `
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ? AND m.imageUrl IS NOT NULL ${scopeSql}
  `;

  const models = db.prepare(`
    SELECT TRIM(m.model) AS value, COUNT(*) AS count
    ${baseSql} AND NULLIF(TRIM(m.model), '') IS NOT NULL
    GROUP BY TRIM(m.model)
    ORDER BY count DESC, value COLLATE NOCASE ASC
  `).all(...scopeParams);
  const workflows = db.prepare(`
    SELECT TRIM(m.workflow) AS value, COUNT(*) AS count
    ${baseSql} AND NULLIF(TRIM(m.workflow), '') IS NOT NULL
    GROUP BY TRIM(m.workflow)
    ORDER BY count DESC, value COLLATE NOCASE ASC
  `).all(...scopeParams);
  const aspectRows = db.prepare(`
    SELECT
      CASE
        WHEN m.width = m.height THEN 'square'
        WHEN m.width > m.height THEN 'landscape'
        WHEN m.height > m.width THEN 'portrait'
      END AS aspect,
      COUNT(*) AS count
    ${baseSql} AND m.width > 0 AND m.height > 0
    GROUP BY aspect
  `).all(...scopeParams) as Array<{ aspect: 'square' | 'portrait' | 'landscape'; count: number }>;
  const aspects = { square: 0, portrait: 0, landscape: 0 };
  aspectRows.forEach(row => { if (row.aspect) aspects[row.aspect] = row.count; });

  res.json({ models, workflows, aspects });
});

router.get('/random-prompt', authenticate, (req, res) => {
  const user = (req as any).user;
  const source = req.query.source === 'favorite' ? 'favorite' : 'liked';
  const favoriteColumn = source === 'favorite' ? 'm.isFavorite' : 'm.isPromptFavorite';
  const result = db.prepare(`
    SELECT COALESCE(
      NULLIF(TRIM(m.generationPrompt), ''),
      NULLIF(TRIM(m.prompt), ''),
      TRIM(m.text)
    ) AS prompt
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ?
      AND m.role = 'bot'
      AND ${favoriteColumn} = 1
      AND TRIM(COALESCE(
        NULLIF(TRIM(m.generationPrompt), ''),
        NULLIF(TRIM(m.prompt), ''),
        TRIM(m.text)
      )) <> ''
    GROUP BY COALESCE(
      NULLIF(TRIM(m.generationPrompt), ''),
      NULLIF(TRIM(m.prompt), ''),
      TRIM(m.text)
    )
    ORDER BY RANDOM()
    LIMIT 1
  `).get(user.id) as { prompt: string } | undefined;

  if (!result?.prompt) {
    return res.status(404).json({
      code: source === 'favorite' ? 'NO_FAVORITE_PROMPTS' : 'NO_LIKED_PROMPTS',
      error: 'No matching saved prompt'
    });
  }

  res.json({ prompt: result.prompt, source });
});

router.get('/group/:messageId', authenticate, (req, res) => {
  const user = (req as any).user;
  const requestedSessionId = getRequestedSessionId(req);
  const representative = db.prepare(`
    SELECT ${galleryGroupKeySql('m')} AS promptGroupKey, s.isArchived, m.sessionId
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE m.id = ? AND s.userId = ? AND m.imageUrl IS NOT NULL
  `).get(req.params.messageId, user.id) as { promptGroupKey: string; isArchived: number; sessionId: string } | undefined;

  if (!representative || (requestedSessionId && representative.sessionId !== requestedSessionId)) {
    return res.status(404).json({ error: 'Gallery group not found' });
  }

  const results = db.prepare(`
    SELECT ${galleryColumnsSql('m')}
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ?
      AND s.isArchived = ?
      AND m.imageUrl IS NOT NULL
      ${requestedSessionId ? 'AND m.sessionId = ?' : ''}
      AND ${galleryGroupKeySql('m')} = ?
    ORDER BY COALESCE(m.isGroupCover, 0) DESC, m.timestamp DESC, m.id DESC
  `).all(
    user.id,
    representative.isArchived,
    ...(requestedSessionId ? [requestedSessionId] : []),
    representative.promptGroupKey
  ) as Record<string, unknown>[];

  res.json({
    items: attachPromptTags(db, results.map(withParsedRandomSelections), 'messageId'),
    total: results.length,
  });
});

router.put('/group/:messageId/cover', authenticate, (req, res) => {
  const user = (req as any).user;
  const representative = db.prepare(`
    SELECT ${galleryGroupKeySql('m')} AS promptGroupKey, s.isArchived
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE m.id = ? AND s.userId = ? AND m.imageUrl IS NOT NULL
  `).get(req.params.messageId, user.id) as { promptGroupKey: string; isArchived: number } | undefined;

  if (!representative) {
    return res.status(404).json({ error: 'Gallery image not found' });
  }

  const groupIds = db.prepare(`
    SELECT m.id
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ?
      AND s.isArchived = ?
      AND m.imageUrl IS NOT NULL
      AND ${galleryGroupKeySql('m')} = ?
  `).all(user.id, representative.isArchived, representative.promptGroupKey) as Array<{ id: string }>;

  if (groupIds.length < 2) {
    return res.status(409).json({ error: 'A gallery group needs at least two images' });
  }

  const updateCover = db.transaction(() => {
    db.prepare(`
      UPDATE messages
      SET isGroupCover = 0
      WHERE id IN (
        SELECT m.id
        FROM messages m
        JOIN sessions s ON s.id = m.sessionId
        WHERE s.userId = ?
          AND s.isArchived = ?
          AND m.imageUrl IS NOT NULL
          AND ${galleryGroupKeySql('m')} = ?
      )
    `).run(user.id, representative.isArchived, representative.promptGroupKey);
    db.prepare('UPDATE messages SET isGroupCover = 1 WHERE id = ?').run(req.params.messageId);
  });
  updateCover();

  res.json({ success: true, messageId: req.params.messageId });
});

router.post('/manual-groups', authenticate, (req, res) => {
  const user = (req as any).user;
  const messageIds = Array.isArray(req.body?.messageIds)
    ? [...new Set(req.body.messageIds
        .filter((id: unknown): id is string => typeof id === 'string')
        .map((id: string) => id.trim())
        .filter(Boolean))]
    : [];

  if (messageIds.length < 2 || messageIds.length > 100) {
    return res.status(400).json({ error: 'Select between 2 and 100 gallery images' });
  }

  const placeholders = messageIds.map(() => '?').join(',');
  const images = db.prepare(`
    SELECT m.id, m.manualGroupId, s.isArchived
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ? AND m.imageUrl IS NOT NULL AND m.id IN (${placeholders})
  `).all(user.id, ...messageIds) as Array<{ id: string; manualGroupId: string | null; isArchived: number }>;

  if (images.length !== messageIds.length) {
    return res.status(404).json({ error: 'One or more gallery images were not found' });
  }
  if (new Set(images.map(image => image.isArchived)).size !== 1) {
    return res.status(409).json({ error: 'Images from active and archived galleries cannot share a group' });
  }

  const manualGroupId = uuidv4();
  const previousGroupIds = [...new Set(images
    .map(image => image.manualGroupId)
    .filter((id): id is string => Boolean(id)))];

  db.transaction(() => {
    db.prepare(`
      UPDATE messages
      SET manualGroupId = ?, isGroupCover = 0
      WHERE id IN (${placeholders})
    `).run(manualGroupId, ...messageIds);
    db.prepare('UPDATE messages SET isGroupCover = 1 WHERE id = ?').run(messageIds[0]);

    const countGroupMembers = db.prepare(`
      SELECT COUNT(*) AS count
      FROM messages m
      JOIN sessions s ON s.id = m.sessionId
      WHERE s.userId = ? AND m.manualGroupId = ? AND m.imageUrl IS NOT NULL
    `);
    const dissolveGroup = db.prepare(`
      UPDATE messages
      SET manualGroupId = NULL, isGroupCover = 0
      WHERE manualGroupId = ?
        AND sessionId IN (SELECT id FROM sessions WHERE userId = ?)
    `);
    previousGroupIds.forEach(previousGroupId => {
      const remaining = countGroupMembers.get(user.id, previousGroupId) as { count: number };
      if (remaining.count < 2) dissolveGroup.run(previousGroupId, user.id);
    });
  })();

  res.status(201).json({ success: true, manualGroupId, messageIds });
});

router.delete('/group/:messageId/manual', authenticate, (req, res) => {
  const user = (req as any).user;
  const representative = db.prepare(`
    SELECT m.manualGroupId
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE m.id = ? AND s.userId = ? AND m.imageUrl IS NOT NULL
  `).get(req.params.messageId, user.id) as { manualGroupId: string | null } | undefined;

  if (!representative) return res.status(404).json({ error: 'Gallery image not found' });
  if (!representative.manualGroupId) {
    return res.status(409).json({ error: 'This image is not in a manual group' });
  }

  const result = db.prepare(`
    UPDATE messages
    SET manualGroupId = NULL, isGroupCover = 0
    WHERE manualGroupId = ?
      AND sessionId IN (SELECT id FROM sessions WHERE userId = ?)
  `).run(representative.manualGroupId, user.id);

  res.json({ success: true, ungrouped: result.changes });
});

router.get('/', authenticate, (req, res) => {
  const user = (req as any).user;
  const requestedSessionId = getRequestedSessionId(req);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
  const offset = Math.min(100_000, Math.max(0, parseInt(req.query.offset as string) || 0));
  const cursorTimestamp = Number(req.query.cursorTimestamp);
  const cursorId = typeof req.query.cursorId === 'string' ? req.query.cursorId.trim() : '';
  const hasCursor = Number.isFinite(cursorTimestamp) && cursorTimestamp > 0 && Boolean(cursorId);
  const onlyArchived = req.query.includeArchived === 'true';
  const favoritesOnly = req.query.favoritesOnly === 'true';
  const promptFavoritesOnly = req.query.promptFavoritesOnly === 'true';
  const groupByPrompt = req.query.groupByPrompt === 'true';
  const selectedModels = getMultiQueryValues(req.query.model);
  const selectedWorkflows = getMultiQueryValues(req.query.workflow);
  const selectedAspects = getMultiQueryValues(req.query.aspect, 3)
    .filter((aspect): aspect is 'square' | 'portrait' | 'landscape' => (
      aspect === 'square' || aspect === 'portrait' || aspect === 'landscape'
    ));
  const rawTags = Array.isArray(req.query.tag) ? req.query.tag : [req.query.tag];
  const selectedTags = [...new Set(rawTags
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim())
    .filter(Boolean))];
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 300) : '';
  
  let filteredSource = `
    FROM messages m JOIN sessions s ON m.sessionId = s.id
    WHERE m.imageUrl IS NOT NULL AND s.userId = ?
  `;
  
  const params: any[] = [user.id];
  
  if (favoritesOnly && !groupByPrompt) {
    filteredSource += ` AND m.isFavorite = 1`;
  }
  if (promptFavoritesOnly && !groupByPrompt) {
    filteredSource += ` AND m.isPromptFavorite = 1`;
  }
  if (selectedModels.length > 0) {
    filteredSource += ` AND TRIM(m.model) IN (${selectedModels.map(() => '?').join(',')})`;
    params.push(...selectedModels);
  }
  if (selectedWorkflows.length > 0) {
    filteredSource += ` AND TRIM(m.workflow) IN (${selectedWorkflows.map(() => '?').join(',')})`;
    params.push(...selectedWorkflows);
  }
  if (selectedAspects.length > 0) {
    const aspectConditions = selectedAspects.map(aspect => (
      aspect === 'square' ? 'm.width = m.height'
        : aspect === 'portrait' ? 'm.height > m.width'
          : 'm.width > m.height'
    ));
    filteredSource += ` AND m.width > 0 AND m.height > 0 AND (${aspectConditions.join(' OR ')})`;
  }
  if (requestedSessionId) {
    filteredSource += ` AND s.id = ?`;
    params.push(requestedSessionId);
  } else {
    filteredSource += ` AND s.isArchived = ?`;
    params.push(onlyArchived ? 1 : 0);
  }
  if (selectedTags.length > 0) {
    filteredSource += ` AND m.id IN (
      SELECT mt.messageId
      FROM message_tags mt
      WHERE mt.tagId IN (${selectedTags.map(() => '?').join(',')})
      GROUP BY mt.messageId
      HAVING COUNT(DISTINCT mt.tagId) = ?
    )`;
    params.push(...selectedTags, selectedTags.length);
  }
  if (search) {
    const tokens = search.match(/[\p{L}\p{N}_-]+/gu) || [];
    if (tokens.length) {
      filteredSource += ` AND m.id IN (
        SELECT messageId FROM message_search WHERE message_search MATCH ?
      )`;
      params.push(tokens.map(token => `"${token.replace(/"/g, '""')}"*`).join(' AND '));
    }
  }

  const includeTotal = req.query.includeTotal === 'true';
  const includeCursor = req.query.includeCursor === 'true';

  if (groupByPrompt) {
    const groupEligibilitySql = [
      favoritesOnly ? 'groupHasFavorite = 1' : '',
      promptFavoritesOnly ? 'groupHasPromptFavorite = 1' : '',
    ].filter(Boolean).join(' AND ') || '1 = 1';
    const groupHavingConditions = [
      favoritesOnly ? 'MAX(COALESCE(m.isFavorite, 0)) = 1' : '',
      promptFavoritesOnly ? 'MAX(COALESCE(m.isPromptFavorite, 0)) = 1' : '',
    ].filter(Boolean);
    const totalRow = includeTotal
      ? db.prepare(`
          SELECT COUNT(*) AS total FROM (
            SELECT ${galleryGroupKeySql('m')} AS galleryGroupKey
            ${filteredSource}
            GROUP BY ${galleryGroupKeySql('m')}
            ${groupHavingConditions.length ? `HAVING ${groupHavingConditions.join(' AND ')}` : ''}
          ) grouped_prompts
        `).get(...params) as { total: number }
      : undefined;
    const groupCursorSql = hasCursor
      ? 'AND (groupTimestamp < ? OR (groupTimestamp = ? AND id < ?))'
      : '';
    const groupParams = hasCursor
      ? [...params, cursorTimestamp, cursorTimestamp, cursorId]
      : params;
    const results = db.prepare(`
      WITH filtered AS (
        SELECT m.*, ${galleryGroupKeySql('m')} AS galleryGroupKey
        ${filteredSource}
      ), ranked AS (
        SELECT filtered.*,
          COUNT(*) OVER (PARTITION BY galleryGroupKey) AS groupCount,
          MAX(COALESCE(isFavorite, 0)) OVER (PARTITION BY galleryGroupKey) AS groupHasFavorite,
          MAX(COALESCE(isPromptFavorite, 0)) OVER (PARTITION BY galleryGroupKey) AS groupHasPromptFavorite,
          MAX(timestamp) OVER (PARTITION BY galleryGroupKey) AS groupTimestamp,
          ROW_NUMBER() OVER (
            PARTITION BY galleryGroupKey
            ORDER BY COALESCE(isGroupCover, 0) DESC, timestamp DESC, id DESC
          ) AS promptGroupRank
        FROM filtered
      )
      SELECT ${galleryColumnsSql('ranked')}, groupCount, groupHasFavorite, groupHasPromptFavorite, groupTimestamp
      FROM ranked
      WHERE promptGroupRank = 1 AND ${groupEligibilitySql}
      ${groupCursorSql}
      ORDER BY groupTimestamp DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...groupParams, limit, hasCursor ? 0 : offset) as Record<string, unknown>[];
    const enrichedResults = attachPromptTags(db, results.map(withParsedRandomSelections), 'messageId');
    const lastResult = results[results.length - 1] as { groupTimestamp?: number; messageId?: string } | undefined;
    const nextCursor = results.length === limit && lastResult?.groupTimestamp && lastResult?.messageId
      ? { timestamp: lastResult.groupTimestamp, id: lastResult.messageId }
      : null;

    if (includeTotal) {
      return res.json({ items: enrichedResults, total: totalRow!.total, nextCursor });
    }
    if (includeCursor) {
      return res.json({ items: enrichedResults, nextCursor });
    }
    return res.json(enrichedResults);
  }

  const totalRow = includeTotal
    ? db.prepare(`SELECT COUNT(*) AS total ${filteredSource}`).get(...params) as { total: number }
    : undefined;
  const pageSource = hasCursor
    ? `${filteredSource} AND (m.timestamp < ? OR (m.timestamp = ? AND m.id < ?))`
    : filteredSource;
  const pageParams = hasCursor
    ? [...params, cursorTimestamp, cursorTimestamp, cursorId]
    : params;
  const results = db.prepare(`
    SELECT ${galleryColumnsSql('m')}
    ${pageSource}
    ORDER BY m.timestamp DESC, m.id DESC LIMIT ? OFFSET ?
  `).all(...pageParams, limit, hasCursor ? 0 : offset) as Record<string, unknown>[];
  const enrichedResults = attachPromptTags(db, results.map(withParsedRandomSelections), 'messageId');
  const lastResult = results[results.length - 1] as { timestamp?: number; messageId?: string } | undefined;
  const nextCursor = results.length === limit && lastResult?.timestamp && lastResult?.messageId
    ? { timestamp: lastResult.timestamp, id: lastResult.messageId }
    : null;
  if (includeTotal) {
    return res.json({ items: enrichedResults, total: totalRow!.total, nextCursor });
  }
  if (includeCursor) {
    return res.json({ items: enrichedResults, nextCursor });
  }
  res.json(enrichedResults);
});

export default router;
