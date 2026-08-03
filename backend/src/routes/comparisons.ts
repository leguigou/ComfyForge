import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import db from '../services/database';
import { authenticate } from '../middleware/auth';
import {
  assertUserQueueCapacity,
  broadcastToSession,
  getUserQueueCapacity,
  processQueue,
  QueueCapacityError
} from '../services/queue';
import { getTargetComfyUrl } from '../services/comfy';
import { deleteFiles } from '../services/image';

const router = express.Router();

type StoredFavorite = {
  model?: string;
  workflowFile?: string;
  modelType?: 'checkpoint' | 'diffusion';
  generationDefaults?: Record<string, unknown>;
};

const imageProjection = `
  m.id AS messageId, m.sessionId, m.imageUrl, m.thumbnailUrl, m.prompt, m.text,
  m.generationPrompt, m.timestamp, m.model, m.width, m.height, m.steps, m.cfg,
  m.workflow, m.seed, m.sampler, m.scheduler, m.duration, m.generationStartedAt, m.status,
  m.isFavorite, m.isPromptFavorite, m.comparisonMessageId, m.comparisonSourceId
`;

const parseJson = (value: string | null | undefined): Record<string, any> => {
  try { return value ? JSON.parse(value) : {}; } catch { return {}; }
};

const normalizeModelKey = (model: unknown) => String(model || '')
  .replace(/\\/g, '/')
  .split('/')
  .pop()
  ?.trim()
  .toLowerCase() || '';

const canonicalPair = (firstMessageId: string, secondMessageId: string) => (
  firstMessageId < secondMessageId
    ? [firstMessageId, secondMessageId]
    : [secondMessageId, firstMessageId]
);

const getWorkflowDefaults = (workflowFile: string): Record<string, number | string> => {
  if (path.basename(workflowFile) !== workflowFile || !workflowFile.endsWith('.json')) return {};
  const backendDir = process.cwd().endsWith('backend') ? process.cwd() : path.join(process.cwd(), 'backend');
  const workflowPath = path.join(backendDir, 'workflows', workflowFile);
  if (!fs.existsSync(workflowPath)) return {};
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8')) as Record<string, any>;
  const configPath = workflowPath.replace(/\.json$/, '.config.json');
  const configured = fs.existsSync(configPath) ? parseJson(fs.readFileSync(configPath, 'utf8')).nodeMapping || {} : {};
  const entries = Object.entries(workflow);
  const samplerId = configured.ksampler || entries.find(([, node]) => /KSampler/i.test(node?.class_type || ''))?.[0];
  const latentId = configured.latent || entries.find(([, node]) => (
    node?.inputs && ('width' in node.inputs || 'width_override' in node.inputs)
      && ('height' in node.inputs || 'height_override' in node.inputs)
  ))?.[0];
  const sampler = samplerId ? workflow[samplerId]?.inputs : undefined;
  const latent = latentId ? workflow[latentId]?.inputs : undefined;
  const values: Record<string, unknown> = {
    width: latent?.width ?? latent?.width_override,
    height: latent?.height ?? latent?.height_override,
    steps: sampler?.steps,
    cfg: sampler?.cfg,
    sampler: sampler?.sampler_name,
    scheduler: sampler?.scheduler
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => (
    typeof value === 'number' || (typeof value === 'string' && value.length > 0)
  ))) as Record<string, number | string>;
};

const getUserSettings = (userId: string) => {
  const row = db.prepare('SELECT data FROM user_settings WHERE userId = ?').get(userId) as { data: string } | undefined;
  if (row) return parseJson(row.data);
  const globalRow = db.prepare('SELECT data FROM settings WHERE id = 1').get() as { data: string } | undefined;
  return parseJson(globalRow?.data);
};

router.get('/', authenticate, (req, res) => {
  const user = (req as any).user;
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || ''), 10) || 40));
  const cursorLatestAt = Number(req.query.cursorLatestAt);
  const cursorId = typeof req.query.cursorId === 'string' ? req.query.cursorId.trim() : '';
  const hasCursor = Number.isFinite(cursorLatestAt) && cursorLatestAt > 0 && Boolean(cursorId);
  const fetchedRows = db.prepare(`
    WITH comparison_sources AS (
      SELECT ${imageProjection},
        (
          SELECT COUNT(*) + 1
          FROM messages version
          WHERE version.comparisonSourceId = m.id
            AND version.imageUrl IS NOT NULL
            AND version.status = 'completed'
        ) AS comparisonVersionCount,
        (
          SELECT MAX(version.timestamp)
          FROM messages version
          WHERE version.comparisonSourceId = m.id
            AND version.imageUrl IS NOT NULL
            AND version.status = 'completed'
        ) AS latestComparisonAt
      FROM messages m JOIN sessions s ON s.id = m.sessionId
      WHERE s.userId = ? AND m.role = 'bot' AND m.imageUrl IS NOT NULL
        AND m.status = 'completed'
        AND m.comparisonSourceId IS NULL
        AND EXISTS (
          SELECT 1 FROM messages version
          WHERE version.comparisonSourceId = m.id
            AND version.imageUrl IS NOT NULL
            AND version.status = 'completed'
        )
    )
    SELECT * FROM comparison_sources
    ${hasCursor ? 'WHERE latestComparisonAt < ? OR (latestComparisonAt = ? AND messageId < ?)' : ''}
    ORDER BY latestComparisonAt DESC, messageId DESC
    LIMIT ?
  `).all(...(hasCursor
    ? [user.id, cursorLatestAt, cursorLatestAt, cursorId, limit + 1]
    : [user.id, limit + 1])) as Array<Record<string, unknown> & { messageId: string; latestComparisonAt: number }>;
  const hasMore = fetchedRows.length > limit;
  const rows = fetchedRows.slice(0, limit);
  const last = rows[rows.length - 1];
  res.json({
    items: rows,
    nextCursor: hasMore && last
      ? { latestAt: last.latestComparisonAt, id: last.messageId }
      : null
  });
});

router.get('/status/availability', authenticate, (req, res) => {
  const user = (req as any).user;
  const capacity = getUserQueueCapacity(user.id);
  res.json({ available: capacity.remaining > 0, activeGenerations: capacity.current, capacity });
});

router.post('/batch/generate', authenticate, (req, res) => {
  try {
    const user = (req as any).user;
    const requestedIds = [...new Set(
      (Array.isArray(req.body?.messageIds) ? req.body.messageIds : [])
        .map((value: unknown) => String(value || '').trim())
        .filter(Boolean)
    )].slice(0, 500);
    if (!requestedIds.length) return res.status(400).json({ error: 'Sélectionnez au moins une image' });

    const active = db.prepare("SELECT COUNT(*) AS count FROM queue WHERE status IN ('pending', 'processing')").get() as { count: number };

    const requestedModel = String(req.body?.model || '');
    const requestedType = req.body?.modelType === 'diffusion' ? 'diffusion' : 'checkpoint';
    const activeModel = String(req.body?.activeModel || '');
    const activeModelType = req.body?.activeModelType === 'diffusion' ? 'diffusion' : 'checkpoint';
    const settings = getUserSettings(user.id);
    const favorite = (Array.isArray(settings.favoriteModels) ? settings.favoriteModels : []).find((entry: StoredFavorite) => (
      entry.model === requestedModel && (entry.modelType || 'checkpoint') === requestedType
    )) as StoredFavorite | undefined;
    if (!favorite?.model || !favorite.workflowFile) {
      return res.status(400).json({ error: 'Sélectionnez un modèle favori associé à un workflow' });
    }

    const placeholders = requestedIds.map(() => '?').join(', ');
    const requestedRows = db.prepare(`
      SELECT m.* FROM messages m JOIN sessions s ON s.id = m.sessionId
      WHERE s.userId = ? AND m.id IN (${placeholders}) AND m.role = 'bot'
        AND m.imageUrl IS NOT NULL AND m.status = 'completed'
    `).all(user.id, ...requestedIds) as any[];
    const sourceIds = [...new Set(requestedRows.map(item => item.comparisonSourceId || item.id))];
    if (!sourceIds.length) return res.status(400).json({ error: 'Aucune image terminée dans la sélection' });

    const sourcePlaceholders = sourceIds.map(() => '?').join(', ');
    const sources = db.prepare(`
      SELECT m.* FROM messages m JOIN sessions s ON s.id = m.sessionId
      WHERE s.userId = ? AND m.id IN (${sourcePlaceholders}) AND m.role = 'bot'
        AND m.imageUrl IS NOT NULL AND m.status = 'completed'
      ORDER BY m.timestamp ASC
    `).all(user.id, ...sourceIds) as any[];
    const requestedModelKey = normalizeModelKey(favorite.model);
    const existingRows = db.prepare(`
      SELECT comparisonSourceId, model FROM messages
      WHERE comparisonSourceId IN (${sourcePlaceholders})
        AND status IN ('pending', 'preparing', 'processing', 'completed')
    `).all(...sourceIds) as Array<{ comparisonSourceId: string; model?: string }>;
    const alreadyProcessed = new Set(existingRows
      .filter(item => normalizeModelKey(item.model) === requestedModelKey)
      .map(item => item.comparisonSourceId));
    const eligibleSources = sources.filter(source => (
      normalizeModelKey(source.model) !== requestedModelKey && !alreadyProcessed.has(source.id)
    ));
    if (eligibleSources.length) assertUserQueueCapacity(user.id, eligibleSources.length);

    const defaults = { ...(favorite.generationDefaults || {}), ...getWorkflowDefaults(favorite.workflowFile) };
    const created: Array<{ messageId: string; sourceMessageId: string }> = [];
    const timestampBase = Date.now();
    db.transaction(() => {
      eligibleSources.forEach((source, index) => {
        const executionPrompt = source.generationPrompt || source.prompt || source.text;
        if (!executionPrompt || source.seed === null || source.seed === undefined) return;
        const sourceParams = parseJson(source.generationParams);
        const params: Record<string, any> = {
          ...sourceParams,
          ...defaults,
          comfyModel: favorite.model,
          comfyModelType: requestedType,
          workflowFile: favorite.workflowFile,
          comfyUrl: getTargetComfyUrl(sourceParams.comfyUrl || settings.comfyUrl),
          seed: source.seed,
          unloadBeforeRun: created.length === 0
            ? active.count > 0 || favorite.model !== activeModel || requestedType !== activeModelType
            : false
        };
        const messageId = uuidv4();
        const timestamp = timestampBase + index;
        db.prepare(`
          INSERT INTO messages (
            id, sessionId, role, text, prompt, imageUrl, timestamp, model, width,
            height, steps, cfg, workflow, status, seed, randomSelections,
            generationPrompt, generationParams, comparisonMessageId, comparisonSourceId
          ) VALUES (?, ?, 'bot', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
        `).run(
          messageId, source.sessionId,
          executionPrompt !== source.prompt ? executionPrompt : '', source.prompt,
          timestamp, favorite.model,
          Number(params.width) || source.width, Number(params.height) || source.height,
          Number(params.steps) || source.steps, Number(params.cfg) || source.cfg,
          favorite.workflowFile, source.seed, source.randomSelections,
          executionPrompt, JSON.stringify(params), source.id, source.id
        );
        db.prepare('UPDATE messages SET comparisonMessageId = ? WHERE id = ?').run(messageId, source.id);
        db.prepare(`
          INSERT INTO queue (messageId, userId, prompt, originalPrompt, sessionId, params, status, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(messageId, user.id, executionPrompt, source.prompt, source.sessionId, JSON.stringify(params), timestamp);
        db.prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?').run(timestamp, source.sessionId);
        created.push({ messageId, sourceMessageId: source.id });
      });
    })();

    created.forEach(item => {
      const source = eligibleSources.find(entry => entry.id === item.sourceMessageId);
      if (source) broadcastToSession(source.sessionId, { messageId: item.messageId, status: 'pending', duration: 0, comparisonMessageId: source.id });
    });
    if (created.length) processQueue();
    return res.status(created.length ? 202 : 200).json({
      success: true,
      queued: created.length,
      processed: sourceIds.length,
      messageIds: created.map(item => item.messageId)
    });
  } catch (error: any) {
    if (error instanceof QueueCapacityError) return res.status(error.statusCode).json({
      code: error.code,
      error: 'La file de génération de cet utilisateur est pleine',
      capacity: error.capacity
    });
    return res.status(500).json({ error: error.message || 'Impossible de lancer les comparaisons par lot' });
  }
});

router.delete('/batch', authenticate, (req, res) => {
  try {
    const user = (req as any).user;
    const requestedIds = [...new Set(
      (Array.isArray(req.body?.messageIds) ? req.body.messageIds : [])
        .map((value: unknown) => String(value || '').trim())
        .filter(Boolean)
    )].slice(0, 500);
    if (!requestedIds.length) return res.status(400).json({ error: 'Sélectionnez au moins une image' });
    const placeholders = requestedIds.map(() => '?').join(', ');
    const requestedRows = db.prepare(`
      SELECT m.id, m.comparisonSourceId FROM messages m JOIN sessions s ON s.id = m.sessionId
      WHERE s.userId = ? AND m.id IN (${placeholders}) AND m.role = 'bot'
    `).all(user.id, ...requestedIds) as Array<{ id: string; comparisonSourceId?: string }>;
    const sourceIds = [...new Set(requestedRows.map(item => item.comparisonSourceId || item.id))];
    if (!sourceIds.length) return res.json({ success: true, deleted: 0 });
    const sourcePlaceholders = sourceIds.map(() => '?').join(', ');
    const comparisons = db.prepare(`
      SELECT m.* FROM messages m JOIN sessions s ON s.id = m.sessionId
      WHERE s.userId = ? AND m.comparisonSourceId IN (${sourcePlaceholders}) AND m.role = 'bot'
    `).all(user.id, ...sourceIds) as any[];
    if (comparisons.some(item => ['pending', 'preparing', 'processing'].includes(item.status))) {
      return res.status(409).json({ error: 'Attendez la fin des générations avant de supprimer la sélection' });
    }
    db.transaction(() => {
      for (const comparison of comparisons) {
        if (comparison.isFavorite === 1 || comparison.isPromptFavorite === 1) {
          db.prepare(`
            UPDATE messages SET
              isFavorite = CASE WHEN ? = 1 THEN 1 ELSE isFavorite END,
              isPromptFavorite = CASE WHEN ? = 1 THEN 1 ELSE isPromptFavorite END
            WHERE id = ?
          `).run(comparison.isFavorite === 1 ? 1 : 0, comparison.isPromptFavorite === 1 ? 1 : 0, comparison.comparisonSourceId);
        }
        db.prepare(`
          DELETE FROM comparison_preferences
          WHERE userId = ? AND (firstMessageId = ? OR secondMessageId = ? OR preferredMessageId = ?)
        `).run(user.id, comparison.id, comparison.id, comparison.id);
        db.prepare('DELETE FROM queue WHERE messageId = ?').run(comparison.id);
        db.prepare('DELETE FROM messages WHERE id = ?').run(comparison.id);
      }
      for (const sourceId of sourceIds) {
        db.prepare('UPDATE messages SET comparisonMessageId = NULL WHERE id = ?').run(sourceId);
      }
    })();
    deleteFiles(comparisons);
    return res.json({ success: true, deleted: comparisons.length });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Impossible de supprimer la sélection' });
  }
});

router.get('/:messageId', authenticate, (req, res) => {
  const user = (req as any).user;
  const requested = db.prepare(`
    SELECT ${imageProjection}
    FROM messages m JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ? AND m.id = ? AND m.role = 'bot'
  `).get(user.id, req.params.messageId) as any;
  if (!requested) return res.status(404).json({ error: 'Image introuvable' });

  // Always resolve a generated comparison back to its root reference (A).
  const source = requested.comparisonSourceId
    ? db.prepare(`
        SELECT ${imageProjection}
        FROM messages m JOIN sessions s ON s.id = m.sessionId
        WHERE s.userId = ? AND m.id = ?
      `).get(user.id, requested.comparisonSourceId) as any || requested
    : requested;

  const comparisons = db.prepare(`
    SELECT ${imageProjection}
    FROM messages m JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ? AND m.comparisonSourceId = ? AND m.id <> ?
    ORDER BY m.timestamp ASC
  `).all(user.id, source.messageId, source.messageId) as any[];
  const selectedComparison = requested.comparisonSourceId
    ? comparisons.find(item => item.messageId === requested.messageId) || null
    : comparisons[comparisons.length - 1] || null;
  const preferences = db.prepare(`
    SELECT firstMessageId, secondMessageId, preferredMessageId, updatedAt
    FROM comparison_preferences
    WHERE userId = ? AND sourceMessageId = ?
    ORDER BY updatedAt DESC
  `).all(user.id, source.messageId);

  // `comparison` remains for older clients; new clients consume the full list.
  res.json({
    source,
    comparisons,
    comparison: selectedComparison,
    selectedMessageId: requested.messageId,
    preferences
  });
});

router.put('/:messageId/preference', authenticate, (req, res) => {
  try {
    const user = (req as any).user;
    const requested = db.prepare(`
      SELECT m.id, m.comparisonSourceId
      FROM messages m JOIN sessions s ON s.id = m.sessionId
      WHERE s.userId = ? AND m.id = ? AND m.role = 'bot'
    `).get(user.id, req.params.messageId) as { id: string; comparisonSourceId?: string } | undefined;
    if (!requested) return res.status(404).json({ error: 'Comparaison introuvable' });
    const sourceMessageId = requested.comparisonSourceId || requested.id;
    const firstRequested = String(req.body?.firstMessageId || '');
    const secondRequested = String(req.body?.secondMessageId || '');
    if (!firstRequested || !secondRequested || firstRequested === secondRequested) {
      return res.status(400).json({ error: 'Sélectionnez deux versions différentes' });
    }

    const pairRows = db.prepare(`
      SELECT m.id FROM messages m JOIN sessions s ON s.id = m.sessionId
      WHERE s.userId = ?
        AND m.id IN (?, ?)
        AND (m.id = ? OR m.comparisonSourceId = ?)
        AND m.status = 'completed' AND m.imageUrl IS NOT NULL
    `).all(user.id, firstRequested, secondRequested, sourceMessageId, sourceMessageId) as Array<{ id: string }>;
    if (new Set(pairRows.map(item => item.id)).size !== 2) {
      return res.status(400).json({ error: 'Ces versions ne peuvent pas être évaluées ensemble' });
    }

    const [firstMessageId, secondMessageId] = canonicalPair(firstRequested, secondRequested);
    const choice = req.body?.choice;
    if (choice === null) {
      db.prepare(`
        DELETE FROM comparison_preferences
        WHERE userId = ? AND firstMessageId = ? AND secondMessageId = ?
      `).run(user.id, firstMessageId, secondMessageId);
      return res.json({ success: true, preference: null });
    }
    if (choice !== 'tie' && choice !== firstRequested && choice !== secondRequested) {
      return res.status(400).json({ error: 'Appréciation invalide' });
    }

    const preferredMessageId = choice === 'tie' ? null : choice;
    const updatedAt = Date.now();
    db.prepare(`
      INSERT INTO comparison_preferences (
        userId, sourceMessageId, firstMessageId, secondMessageId, preferredMessageId, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId, firstMessageId, secondMessageId) DO UPDATE SET
        sourceMessageId = excluded.sourceMessageId,
        preferredMessageId = excluded.preferredMessageId,
        updatedAt = excluded.updatedAt
    `).run(user.id, sourceMessageId, firstMessageId, secondMessageId, preferredMessageId, updatedAt);
    return res.json({
      success: true,
      preference: { firstMessageId, secondMessageId, preferredMessageId, updatedAt }
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Impossible d’enregistrer cette appréciation' });
  }
});

router.post('/:messageId', authenticate, (req, res) => {
  try {
    const user = (req as any).user;
    const requested = db.prepare(`
      SELECT m.* FROM messages m JOIN sessions s ON s.id = m.sessionId
      WHERE s.userId = ? AND m.id = ? AND m.role = 'bot'
        AND m.imageUrl IS NOT NULL AND m.status = 'completed'
    `).get(user.id, req.params.messageId) as any;
    if (!requested) return res.status(404).json({ error: 'Image terminée introuvable' });
    const source = requested.comparisonSourceId
      ? db.prepare(`
          SELECT m.* FROM messages m JOIN sessions s ON s.id = m.sessionId
          WHERE s.userId = ? AND m.id = ? AND m.role = 'bot'
            AND m.imageUrl IS NOT NULL AND m.status = 'completed'
        `).get(user.id, requested.comparisonSourceId) as any
      : requested;
    if (!source) return res.status(404).json({ error: 'Image originale introuvable' });

    assertUserQueueCapacity(user.id);

    const requestedModel = String(req.body?.model || '');
    const requestedType = req.body?.modelType === 'diffusion' ? 'diffusion' : 'checkpoint';
    const activeModel = String(req.body?.activeModel || '');
    const activeModelType = req.body?.activeModelType === 'diffusion' ? 'diffusion' : 'checkpoint';
    const settings = getUserSettings(user.id);
    const favorite = (Array.isArray(settings.favoriteModels) ? settings.favoriteModels : []).find((entry: StoredFavorite) => (
      entry.model === requestedModel && (entry.modelType || 'checkpoint') === requestedType
    )) as StoredFavorite | undefined;
    if (!favorite?.model || !favorite.workflowFile) {
      return res.status(400).json({ error: 'Sélectionnez un modèle favori associé à un workflow' });
    }
    const requestedModelKey = normalizeModelKey(favorite.model);
    if (requestedModelKey === normalizeModelKey(source.model)) {
      return res.status(400).json({ error: 'Le modèle de comparaison doit être différent du modèle source' });
    }
    const existingModel = (db.prepare(`
      SELECT id, model FROM messages
      WHERE comparisonSourceId = ? AND status IN ('pending', 'preparing', 'processing', 'completed')
    `).all(source.id) as Array<{ id: string; model?: string }>).find(item => (
      normalizeModelKey(item.model) === requestedModelKey
    ));
    if (existingModel) {
      return res.status(409).json({
        error: 'Ce modèle a déjà été utilisé pour cette comparaison',
        comparisonMessageId: existingModel.id
      });
    }

    const executionPrompt = source.generationPrompt || source.prompt || source.text;
    if (!executionPrompt || source.seed === null) {
      return res.status(400).json({ error: 'Le prompt ou la seed source est indisponible' });
    }

    const sourceParams = parseJson(source.generationParams);
    // The target workflow is authoritative for resolution/sampling settings.
    // Stored favorite defaults are only a compatibility fallback for custom
    // workflows whose values cannot be detected statically.
    const defaults = { ...(favorite.generationDefaults || {}), ...getWorkflowDefaults(favorite.workflowFile) };
    const params: Record<string, any> = {
      ...sourceParams,
      ...defaults,
      comfyModel: favorite.model,
      comfyModelType: requestedType,
      workflowFile: favorite.workflowFile,
      comfyUrl: getTargetComfyUrl(sourceParams.comfyUrl || settings.comfyUrl),
      seed: source.seed,
      // Keep the already active target model in memory. A full ComfyUI unload
      // is only needed when the comparison switches to another model/type.
      unloadBeforeRun: favorite.model !== activeModel || requestedType !== activeModelType
    };
    const messageId = uuidv4();
    const timestamp = Date.now();

    db.transaction(() => {
      db.prepare(`
        INSERT INTO messages (
          id, sessionId, role, text, prompt, imageUrl, timestamp, model, width,
          height, steps, cfg, workflow, status, seed, randomSelections,
          generationPrompt, generationParams, comparisonMessageId, comparisonSourceId
        ) VALUES (?, ?, 'bot', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
      `).run(
        messageId, source.sessionId,
        executionPrompt !== source.prompt ? executionPrompt : '', source.prompt,
        timestamp, favorite.model,
        Number(params.width) || source.width, Number(params.height) || source.height,
        Number(params.steps) || source.steps, Number(params.cfg) || source.cfg,
        favorite.workflowFile, source.seed, source.randomSelections,
        executionPrompt, JSON.stringify(params), source.id, source.id
      );
      db.prepare('UPDATE messages SET comparisonMessageId = ? WHERE id = ?').run(messageId, source.id);
      db.prepare(`
        INSERT INTO queue (messageId, userId, prompt, originalPrompt, sessionId, params, status, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(messageId, user.id, executionPrompt, source.prompt, source.sessionId, JSON.stringify(params), timestamp);
      db.prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?').run(timestamp, source.sessionId);
    })();

    broadcastToSession(source.sessionId, { messageId, status: 'pending', duration: 0, comparisonMessageId: source.id });
    processQueue();
    return res.status(202).json({ success: true, messageId });
  } catch (error: any) {
    if (error instanceof QueueCapacityError) return res.status(error.statusCode).json({
      code: error.code,
      error: 'La file de génération de cet utilisateur est pleine',
      capacity: error.capacity
    });
    return res.status(500).json({ error: error.message || 'Impossible de lancer la comparaison' });
  }
});

router.delete('/:messageId', authenticate, (req, res) => {
  try {
    const user = (req as any).user;
    const comparison = db.prepare(`
      SELECT m.* FROM messages m JOIN sessions s ON s.id = m.sessionId
      WHERE s.userId = ? AND m.id = ? AND m.role = 'bot'
    `).get(user.id, req.params.messageId) as any;
    if (!comparison?.comparisonSourceId) {
      return res.status(400).json({ error: 'Seule une image de comparaison peut être supprimée ici' });
    }
    if (['pending', 'preparing', 'processing'].includes(comparison.status)) {
      return res.status(409).json({ error: 'Attendez la fin de la génération avant de supprimer cette image' });
    }

    const source = db.prepare(`
      SELECT m.id FROM messages m JOIN sessions s ON s.id = m.sessionId
      WHERE s.userId = ? AND m.id = ?
    `).get(user.id, comparison.comparisonSourceId) as { id: string } | undefined;
    if (!source) return res.status(404).json({ error: 'Image originale introuvable' });

    const nextComparison = db.prepare(`
      SELECT id FROM messages
      WHERE comparisonSourceId = ? AND id <> ?
      ORDER BY timestamp DESC LIMIT 1
    `).get(source.id, comparison.id) as { id: string } | undefined;
    const transferredFavorite = comparison.isFavorite === 1;
    const transferredPromptFavorite = comparison.isPromptFavorite === 1;

    db.transaction(() => {
      if (transferredFavorite || transferredPromptFavorite) {
        db.prepare(`
          UPDATE messages SET
            isFavorite = CASE WHEN ? = 1 THEN 1 ELSE isFavorite END,
            isPromptFavorite = CASE WHEN ? = 1 THEN 1 ELSE isPromptFavorite END
          WHERE id = ?
        `).run(transferredFavorite ? 1 : 0, transferredPromptFavorite ? 1 : 0, source.id);
      }
      db.prepare(`
        DELETE FROM comparison_preferences
        WHERE userId = ? AND (firstMessageId = ? OR secondMessageId = ? OR preferredMessageId = ?)
      `).run(user.id, comparison.id, comparison.id, comparison.id);
      db.prepare('DELETE FROM queue WHERE messageId = ?').run(comparison.id);
      db.prepare('DELETE FROM messages WHERE id = ?').run(comparison.id);
      db.prepare('UPDATE messages SET comparisonMessageId = ? WHERE id = ?')
        .run(nextComparison?.id || null, source.id);
    })();

    deleteFiles([comparison]);
    return res.json({
      success: true,
      sourceMessageId: source.id,
      transferredFavorite,
      transferredPromptFavorite
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Impossible de supprimer cette comparaison' });
  }
});

export default router;
