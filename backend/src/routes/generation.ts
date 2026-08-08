import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import db from '../services/database';
import { authenticate } from '../middleware/auth';
import { getTargetComfyUrl } from '../services/comfy';
import {
  assertUserQueueCapacity,
  broadcastToSession,
  getUserQueueCapacity,
  processQueue,
  QueueCapacityError
} from '../services/queue';
import { ServiceUrlError } from '../security/service-url';
import { GenerationParams } from '../types';
import { replaceAutoPromptTags } from '../services/prompt-tags';

const router = express.Router();

type RetryableMessage = {
  id: string;
  sessionId: string;
  prompt: string;
  generationPrompt: string | null;
  generationParams: string | null;
  model: string | null;
  width: number | null;
  height: number | null;
  steps: number | null;
  cfg: number | null;
  workflow: string | null;
  seed: number | null;
  sampler: string | null;
  scheduler: string | null;
};

const normalizeGenerationParams = (params: any, overrides: Partial<GenerationParams> = {}): GenerationParams => {
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  );
  const merged = { ...(params || {}), ...definedOverrides };
  return {
    comfyModel: merged.comfyModel,
    comfyModelType: merged.comfyModelType,
    comfyUrl: getTargetComfyUrl(merged.comfyUrl),
    workflowFile: merged.workflowFile,
    width: Number(merged.width) || undefined,
    height: Number(merged.height) || undefined,
    steps: Number(merged.steps) || undefined,
    cfg: Number(merged.cfg) || undefined,
    seed: Number.isFinite(Number(merged.seed)) ? Number(merged.seed) : undefined,
    sampler: merged.sampler,
    scheduler: merged.scheduler,
    negativePrompt: merged.negativePrompt,
    nodeMapping: merged.nodeMapping
  };
};

const parseStoredParams = (value: string | null) => {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

router.get('/estimate', authenticate, (req, res) => {
  const user = (req as any).user;
  const model = typeof req.query.model === 'string' ? req.query.model.trim() : '';
  const workflow = typeof req.query.workflow === 'string' ? req.query.workflow.trim() : '';

  if (!model || !workflow) {
    return res.status(400).json({ error: 'Model and workflow are required' });
  }

  const estimate = db.prepare(`
    SELECT AVG(duration) AS averageDuration, COUNT(*) AS sampleCount
    FROM (
      SELECT m.duration
      FROM messages m
      JOIN sessions s ON s.id = m.sessionId
      WHERE s.userId = ?
        AND m.model = ?
        AND m.workflow = ?
        AND m.status = 'completed'
        AND m.imageUrl IS NOT NULL
        AND m.duration > 0
      ORDER BY m.timestamp DESC
      LIMIT 8
    )
  `).get(user.id, model, workflow) as {
    averageDuration: number | null;
    sampleCount: number;
  };

  res.json({
    estimateSeconds: estimate.averageDuration === null
      ? null
      : Math.max(1, Math.round(estimate.averageDuration)),
    sampleCount: estimate.sampleCount
  });
});

router.get('/active', authenticate, (req, res) => {
  const user = (req as any).user;
  const generations = db.prepare(`
    SELECT q.messageId, q.sessionId, q.status, q.createdAt
    FROM queue q
    JOIN sessions s ON s.id = q.sessionId
    WHERE s.userId = ? AND q.status IN ('processing', 'pending')
    ORDER BY CASE q.status WHEN 'processing' THEN 0 ELSE 1 END, q.createdAt ASC
  `).all(user.id);
  res.json(generations);
});

const enqueueRetry = (message: RetryableMessage, userId: string, fallbackParams: any, createdAt: number) => {
  const params = normalizeGenerationParams(
    { ...fallbackParams, ...parseStoredParams(message.generationParams) },
    {
      comfyModel: message.model || undefined,
      workflowFile: message.workflow || undefined,
      width: message.width || undefined,
      height: message.height || undefined,
      steps: message.steps || undefined,
      cfg: message.cfg || undefined,
      seed: message.seed ?? undefined,
      sampler: message.sampler || undefined,
      scheduler: message.scheduler || undefined
    }
  );
  const executionPrompt = message.generationPrompt || message.prompt;

  db.prepare('DELETE FROM queue WHERE messageId = ?').run(message.id);
  db.prepare(`
    INSERT INTO queue (messageId, userId, prompt, originalPrompt, sessionId, params, status, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(message.id, userId, executionPrompt, message.prompt, message.sessionId, JSON.stringify(params), createdAt);
  db.prepare(`
    UPDATE messages
    SET status = 'pending', text = ?, imageUrl = NULL, thumbnailUrl = NULL,
        duration = NULL, generationStartedAt = NULL, generationPrompt = ?, generationParams = ?
    WHERE id = ?
  `).run(executionPrompt !== message.prompt ? executionPrompt : '', executionPrompt, JSON.stringify(params), message.id);
};

router.post('/generate', authenticate, async (req, res) => {
  try {
    const user = (req as any).user;
    const { prompt, originalPrompt, sessionId, params, recoveryMessageId } = req.body;
    if (typeof prompt !== 'string' || !prompt.trim() || !sessionId) {
      return res.status(400).json({ success: false, error: 'Prompt and sessionId are required' });
    }

    const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND userId = ?').get(sessionId, user.id);
    if (!session) {
      return res.status(403).json({ success: false, error: 'Unauthorized session' });
    }
    assertUserQueueCapacity(user.id);

    const timestamp = Date.now();
    let messageId: string;
    let userMessageId: string | undefined;
    let tags: Array<{ slug: string; category: string; labelFr: string; labelEn: string }>;

    if (typeof recoveryMessageId === 'string' && recoveryMessageId) {
      const recovery = db.prepare(`
        SELECT m.* FROM messages m
        JOIN sessions s ON s.id = m.sessionId
        WHERE m.id = ? AND m.sessionId = ? AND s.userId = ?
          AND m.role = 'bot' AND m.imageUrl IS NULL AND m.status = 'failed'
      `).get(recoveryMessageId, sessionId, user.id) as RetryableMessage | undefined;
      if (!recovery) {
        return res.status(404).json({ success: false, error: 'Prompt récupérable introuvable' });
      }

      messageId = recovery.id;
      tags = db.transaction(() => {
        enqueueRetry(recovery, user.id, params, timestamp);
        db.prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?').run(timestamp, sessionId);
        return replaceAutoPromptTags(db, messageId, recovery.generationPrompt || recovery.prompt)
          .map(({ slug, category, labelFr, labelEn }) => ({ slug, category, labelFr, labelEn }));
      })();
    } else {
      const safeParams = normalizeGenerationParams(params);
      messageId = uuidv4();
      userMessageId = uuidv4();

      // Si prompt est différent d'originalPrompt, c'est que l'IA a bossé
      const isEnhanced = prompt && originalPrompt && prompt !== originalPrompt;
      const displayPrompt = originalPrompt || prompt;
      const enhancedText = isEnhanced ? prompt : '';
      const model = params?.comfyModel || 'dirtyRealism_DMDSAT.safetensors';
      const workflowFile = params?.workflowFile || 'workflow_lcm.json';
      const seed = (params?.seed && params.seed !== -1) ? params.seed : Math.floor(Math.random() * 1000000000000000);
      const randomSelections = Array.isArray(req.body.randomSelections)
        ? req.body.randomSelections.slice(0, 20).map((selection: any) => ({
            listId: String(selection?.listId || '').slice(0, 80),
            name: String(selection?.name || '').slice(0, 120),
            slug: String(selection?.slug || '').slice(0, 80),
            value: String(selection?.value || '').slice(0, 300)
          })).filter((selection: { slug: string; value: string }) => selection.slug && selection.value)
        : [];

      const insertMsg = db.prepare('INSERT INTO messages (id, sessionId, role, text, prompt, imageUrl, timestamp, model, width, height, steps, cfg, workflow, status, seed, randomSelections, generationPrompt, generationParams) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

      if (!req.body.isRegeneration) {
        insertMsg.run(userMessageId, sessionId, 'user', displayPrompt, '', null, timestamp - 1, null, null, null, null, null, null, 'completed', null, null, null, null);
      }

      const storedParams = { ...safeParams, seed };
      insertMsg.run(messageId, sessionId, 'bot', enhancedText, displayPrompt, null, timestamp, model, params?.width || 896, params?.height || 1152, params?.steps || 8, params?.cfg || 1.1, workflowFile, 'pending', seed, JSON.stringify(randomSelections), prompt, JSON.stringify(storedParams));
      tags = replaceAutoPromptTags(db, messageId, prompt)
        .map(({ slug, category, labelFr, labelEn }) => ({ slug, category, labelFr, labelEn }));

      db.prepare('INSERT INTO queue (messageId, userId, prompt, originalPrompt, sessionId, params, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(messageId, user.id, prompt, originalPrompt, sessionId, JSON.stringify(storedParams), 'pending', timestamp);

      db.prepare('UPDATE sessions SET title = ?, updatedAt = ? WHERE id = ? AND title = \'New Chat\'').run(displayPrompt.substring(0, 30), timestamp, sessionId);
      db.prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?').run(timestamp, sessionId);
    }

    // Publish the new queue size immediately. Without this, clients only hear
    // about additional pending items when the active job emits its next update.
    broadcastToSession(sessionId, { messageId, status: 'pending', duration: 0 });

    // Claim the next task before replying. processQueue marks it as preparing
    // synchronously, then switches to processing only after ComfyUI accepts it.
    void processQueue();
    const currentMessageState = db.prepare(
      'SELECT status, generationStartedAt FROM messages WHERE id = ?'
    ).get(messageId) as { status: 'pending' | 'preparing' | 'processing'; generationStartedAt?: number } | undefined;

    res.json({
      success: true,
      messageId,
      userMessageId: req.body.isRegeneration ? undefined : userMessageId,
      status: currentMessageState?.status || 'pending',
      generationStartedAt: currentMessageState?.generationStartedAt,
      tags
    });
  } catch (error: any) {
    if (error instanceof QueueCapacityError) return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      error: 'La file de génération de cet utilisateur est pleine',
      capacity: error.capacity
    });
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ success: false, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/retry/:messageId', authenticate, (req, res) => {
  try {
    const user = (req as any).user;
    assertUserQueueCapacity(user.id);
    const message = db.prepare(`
      SELECT m.* FROM messages m
      JOIN sessions s ON s.id = m.sessionId
      WHERE m.id = ? AND s.userId = ? AND m.role = 'bot'
        AND m.imageUrl IS NULL AND m.status IN ('failed', 'pending', 'preparing', 'processing')
    `).get(req.params.messageId, user.id) as RetryableMessage | undefined;
    if (!message) return res.status(404).json({ success: false, error: 'Génération inachevée introuvable' });

    const transaction = db.transaction(() => enqueueRetry(message, user.id, req.body?.params, Date.now()));
    transaction();
    broadcastToSession(message.sessionId, { messageId: message.id, status: 'pending', duration: 0 });
    processQueue();
    return res.json({ success: true, messageId: message.id, queued: 1 });
  } catch (error: any) {
    if (error instanceof QueueCapacityError) return res.status(error.statusCode).json({ success: false, code: error.code, error: 'La file de génération de cet utilisateur est pleine', capacity: error.capacity });
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ success: false, error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/retry-incomplete', authenticate, (req, res) => {
  try {
    const user = (req as any).user;
    const retryableMessages = db.prepare(`
      SELECT m.* FROM messages m
      JOIN sessions s ON s.id = m.sessionId
      LEFT JOIN queue q ON q.messageId = m.id
      WHERE s.userId = ? AND m.role = 'bot' AND m.imageUrl IS NULL
        AND m.status IN ('failed', 'pending', 'preparing', 'processing')
        AND (m.status = 'failed' OR q.id IS NULL)
      ORDER BY m.timestamp ASC
      LIMIT 500
    `).all(user.id) as RetryableMessage[];

    const capacity = getUserQueueCapacity(user.id);
    if (capacity.remaining === 0) throw new QueueCapacityError(capacity, 1);
    const availableSlots = capacity.remaining ?? capacity.batchLimit;
    const messages = retryableMessages.slice(0, Math.min(availableSlots, capacity.batchLimit));

    const now = Date.now();
    const transaction = db.transaction(() => {
      messages.forEach((message, index) => enqueueRetry(message, user.id, req.body?.params, now + index));
    });
    transaction();
    messages.forEach(message => broadcastToSession(message.sessionId, { messageId: message.id, status: 'pending', duration: 0 }));
    processQueue();
    return res.json({
      success: true,
      queued: messages.length,
      skipped: Math.max(0, retryableMessages.length - messages.length),
      messageIds: messages.map(message => message.id),
      capacity: getUserQueueCapacity(user.id)
    });
  } catch (error: any) {
    if (error instanceof QueueCapacityError) return res.status(error.statusCode).json({ success: false, code: error.code, error: 'La file de génération de cet utilisateur est pleine', capacity: error.capacity });
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ success: false, error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/pending/:messageId/prompt', authenticate, (req, res) => {
  try {
    const user = (req as any).user;
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, 20_000) : '';
    if (!prompt) return res.status(400).json({ success: false, error: 'Prompt is required' });

    const pendingMessage = db.prepare(`
      SELECT m.id, m.sessionId, m.timestamp, m.prompt, q.id AS queueId
      FROM messages m
      JOIN sessions s ON s.id = m.sessionId
      JOIN queue q ON q.messageId = m.id
      WHERE m.id = ? AND s.userId = ? AND m.role = 'bot'
        AND m.status = 'pending' AND q.status = 'pending'
    `).get(req.params.messageId, user.id) as {
      id: string;
      sessionId: string;
      timestamp: number;
      prompt: string;
      queueId: number;
    } | undefined;
    if (!pendingMessage) {
      return res.status(409).json({
        success: false,
        code: 'GENERATION_ALREADY_STARTED',
        error: 'Generation has already started and can no longer be edited',
      });
    }

    const linkedUserMessage = db.prepare(`
      SELECT id FROM messages
      WHERE sessionId = ? AND role = 'user' AND timestamp = ? AND text = ?
      LIMIT 1
    `).get(pendingMessage.sessionId, pendingMessage.timestamp - 1, pendingMessage.prompt) as { id: string } | undefined;

    const tags = db.transaction(() => {
      const queueUpdate = db.prepare(`
        UPDATE queue SET prompt = ?, originalPrompt = ?
        WHERE id = ? AND status = 'pending'
      `).run(prompt, prompt, pendingMessage.queueId);
      if (queueUpdate.changes !== 1) throw new Error('GENERATION_ALREADY_STARTED');

      db.prepare(`
        UPDATE messages
        SET text = '', prompt = ?, generationPrompt = ?
        WHERE id = ? AND status = 'pending'
      `).run(prompt, prompt, pendingMessage.id);
      if (linkedUserMessage) {
        db.prepare('UPDATE messages SET text = ? WHERE id = ?').run(prompt, linkedUserMessage.id);
      }
      db.prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?').run(Date.now(), pendingMessage.sessionId);
      return replaceAutoPromptTags(db, pendingMessage.id, prompt)
        .map(({ slug, category, labelFr, labelEn }) => ({ slug, category, labelFr, labelEn }));
    })();

    const update = {
      messageId: pendingMessage.id,
      status: 'pending' as const,
      text: '',
      prompt,
      generationPrompt: prompt,
      tags,
      linkedUserMessageId: linkedUserMessage?.id,
      linkedUserText: linkedUserMessage ? prompt : undefined,
    };
    broadcastToSession(pendingMessage.sessionId, update);
    return res.json({ success: true, ...update });
  } catch (error: any) {
    if (error?.message === 'GENERATION_ALREADY_STARTED') {
      return res.status(409).json({
        success: false,
        code: 'GENERATION_ALREADY_STARTED',
        error: 'Generation has already started and can no longer be edited',
      });
    }
    return res.status(500).json({ success: false, error: error.message || 'Failed to update prompt' });
  }
});

router.post('/interrupt', authenticate, async (req, res) => {
  try {
    const user = (req as any).user;
    const targetUrl = getTargetComfyUrl(req.body.params?.comfyUrl);
    
    // 1. Send interrupt to ComfyUI
    try {
      await axios.post(`${targetUrl}/interrupt`);
    } catch (e) {
      console.warn('[Interrupt] ComfyUI interrupt call failed (might be already idle)');
    }
    
    // 2. Identify messages to be cancelled
    const affectedMessages = db.prepare(`
      SELECT m.id, m.sessionId 
      FROM messages m 
      JOIN sessions s ON m.sessionId = s.id 
      WHERE m.status IN ('pending', 'preparing', 'processing')
      AND s.userId = ?
    `).all(user.id) as any[];

    // 3. Clear user's queue in database
    db.prepare(`
      DELETE FROM queue 
      WHERE sessionId IN (SELECT id FROM sessions WHERE userId = ?)
    `).run(user.id);
    
    // 4. Mark all pending/processing messages as failed and notify via WS
    db.prepare(`
      UPDATE messages 
      SET status = 'failed', text = 'Interrompu par l''utilisateur' 
      WHERE status IN ('pending', 'preparing', 'processing')
      AND sessionId IN (SELECT id FROM sessions WHERE userId = ?)
    `).run(user.id);

    affectedMessages.forEach(msg => {
      broadcastToSession(msg.sessionId, { 
        messageId: msg.id, 
        status: 'failed', 
        error: 'Interrompu par l\'utilisateur' 
      });
    });

    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ error: error.message });
    console.error('[Interrupt] Error:', error);
    res.status(500).json({ error: 'Failed to interrupt' });
  }
});

export default router;
