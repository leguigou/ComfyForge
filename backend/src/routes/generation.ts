import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import db from '../services/database';
import { authenticate } from '../middleware/auth';
import { getTargetComfyUrl } from '../services/comfy';
import { broadcastToSession, processQueue } from '../services/queue';
import { ServiceUrlError } from '../security/service-url';
import { GenerationParams } from '../types';

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

const enqueueRetry = (message: RetryableMessage, fallbackParams: any, createdAt: number) => {
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
    INSERT INTO queue (messageId, prompt, originalPrompt, sessionId, params, status, createdAt)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(message.id, executionPrompt, message.prompt, message.sessionId, JSON.stringify(params), createdAt);
  db.prepare(`
    UPDATE messages
    SET status = 'pending', text = ?, imageUrl = NULL, thumbnailUrl = NULL,
        duration = NULL, generationPrompt = ?, generationParams = ?
    WHERE id = ?
  `).run(executionPrompt !== message.prompt ? executionPrompt : '', executionPrompt, JSON.stringify(params), message.id);
};

router.post('/generate', authenticate, async (req, res) => {
  try {
    const user = (req as any).user;
    const { prompt, originalPrompt, sessionId, params } = req.body;
    if (typeof prompt !== 'string' || !prompt.trim() || !sessionId) {
      return res.status(400).json({ success: false, error: 'Prompt and sessionId are required' });
    }

    const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND userId = ?').get(sessionId, user.id);
    if (!session) {
      return res.status(403).json({ success: false, error: 'Unauthorized session' });
    }

    const safeParams = normalizeGenerationParams(params);
    const timestamp = Date.now();
    const messageId = uuidv4();
    const userMessageId = uuidv4();
    
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
    
    db.prepare('INSERT INTO queue (messageId, prompt, originalPrompt, sessionId, params, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(messageId, prompt, originalPrompt, sessionId, JSON.stringify(storedParams), 'pending', timestamp);
    
    db.prepare('UPDATE sessions SET title = ?, updatedAt = ? WHERE id = ? AND title = \'New Chat\'').run(displayPrompt.substring(0, 30), timestamp, sessionId);
    db.prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?').run(timestamp, sessionId);
    
    res.json({ success: true, messageId, status: 'pending' });
    
    // Start processing immediately
    processQueue();
  } catch (error: any) {
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ success: false, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/retry/:messageId', authenticate, (req, res) => {
  try {
    const user = (req as any).user;
    const message = db.prepare(`
      SELECT m.* FROM messages m
      JOIN sessions s ON s.id = m.sessionId
      WHERE m.id = ? AND s.userId = ? AND m.role = 'bot'
        AND m.imageUrl IS NULL AND m.status IN ('failed', 'pending', 'processing')
    `).get(req.params.messageId, user.id) as RetryableMessage | undefined;
    if (!message) return res.status(404).json({ success: false, error: 'Génération inachevée introuvable' });

    const transaction = db.transaction(() => enqueueRetry(message, req.body?.params, Date.now()));
    transaction();
    broadcastToSession(message.sessionId, { messageId: message.id, status: 'pending', duration: 0 });
    processQueue();
    return res.json({ success: true, messageId: message.id, queued: 1 });
  } catch (error: any) {
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ success: false, error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/retry-incomplete', authenticate, (req, res) => {
  try {
    const user = (req as any).user;
    const messages = db.prepare(`
      SELECT m.* FROM messages m
      JOIN sessions s ON s.id = m.sessionId
      LEFT JOIN queue q ON q.messageId = m.id
      WHERE s.userId = ? AND m.role = 'bot' AND m.imageUrl IS NULL
        AND m.status IN ('failed', 'pending', 'processing')
        AND (m.status = 'failed' OR q.id IS NULL)
      ORDER BY m.timestamp ASC
      LIMIT 500
    `).all(user.id) as RetryableMessage[];

    const now = Date.now();
    const transaction = db.transaction(() => {
      messages.forEach((message, index) => enqueueRetry(message, req.body?.params, now + index));
    });
    transaction();
    messages.forEach(message => broadcastToSession(message.sessionId, { messageId: message.id, status: 'pending', duration: 0 }));
    processQueue();
    return res.json({ success: true, queued: messages.length, messageIds: messages.map(message => message.id) });
  } catch (error: any) {
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ success: false, error: error.message });
    return res.status(500).json({ success: false, error: error.message });
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
      WHERE m.status IN ('pending', 'processing') 
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
      WHERE status IN ('pending', 'processing') 
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
