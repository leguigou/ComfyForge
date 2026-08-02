import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { WebSocket, WebSocketServer } from 'ws';
import db from './database';
import { getTargetComfyUrl, getWorkflow, isComfyConnectionRefused, parseComfyError, releaseComfyMemory } from './comfy';
import { imagesDir, thumbnailsDir } from './image';
import { QueueTask, GenerationParams, ComfyHistoryEntry } from '../types';
import { writeAuditLog } from './audit-log';
import { resolveComfyHistoryImage, ResolvedComfyHistoryImage } from './comfy-history';

let isProcessingQueue = false;
let wss: WebSocketServer | null = null;
const websocketUsers = new WeakMap<WebSocket, string>();
const COMFY_UNAVAILABLE_MESSAGE = 'ComfyUI est inaccessible. Toutes les générations ont été arrêtées. Vérifiez que ComfyUI est démarré et que son URL est correcte.';

class ComfyUnavailableError extends Error {
  constructor() {
    super(COMFY_UNAVAILABLE_MESSAGE);
    this.name = 'ComfyUnavailableError';
  }
}

export const setWss = (wsServer: WebSocketServer) => {
  wss = wsServer;
};

export const registerWebSocketUser = (client: WebSocket, userId: string) => {
  websocketUsers.set(client, userId);
};

export const getUserQueueRemaining = (userId: string) => {
  const result = db.prepare(`
    SELECT COUNT(*) AS count
    FROM queue q
    JOIN sessions s ON s.id = q.sessionId
    WHERE s.userId = ? AND q.status IN ('pending', 'processing')
  `).get(userId) as { count: number };
  return result.count;
};

export const broadcastToSession = (sessionId: string, data: Record<string, unknown>) => {
  if (!wss) return;
  const session = db.prepare('SELECT userId FROM sessions WHERE id = ?').get(sessionId) as { userId: string } | undefined;
  if (!session) return;

  const payload = JSON.stringify({
    type: 'queue_update',
    sessionId,
    queueRemaining: getUserQueueRemaining(session.userId),
    ...data
  });
  wss.clients.forEach((client: WebSocket) => { 
    if (client.readyState === WebSocket.OPEN && websocketUsers.get(client) === session.userId) {
      client.send(payload);
    }
  });
};

export const processQueue = async () => {
  // Claim the lock BEFORE checking the DB — prevents TOCTOU race
  // where two concurrent calls both see isProcessingQueue === false
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  let task: QueueTask | null = null;
  try {
    task = db.prepare('SELECT * FROM queue WHERE status = ? ORDER BY createdAt ASC LIMIT 1').get('pending') as QueueTask | undefined ?? null;
    if (!task) {
      isProcessingQueue = false;
      return;
    }
    
    console.log(`[Queue] Starting task for message ${task.messageId}...`);
    const generationStartedAt = Date.now();
    db.prepare('UPDATE queue SET status = ? WHERE id = ?').run('processing', task.id);
    db.prepare('UPDATE messages SET status = ?, generationStartedAt = ? WHERE id = ?')
      .run('processing', generationStartedAt, task.messageId);
    broadcastToSession(task.sessionId, {
      messageId: task.messageId,
      status: 'processing',
      generationStartedAt
    });
    const sessionOwner = db.prepare('SELECT userId FROM sessions WHERE id = ?').get(task.sessionId) as { userId: string } | undefined;

    const params: GenerationParams = JSON.parse(task.params);
    const targetComfyUrl = getTargetComfyUrl(params.comfyUrl);

    // Comparisons must start from a clean ComfyUI model state. Doing this in
    // the queue (instead of the HTTP route) keeps the unload directly adjacent
    // to workflow submission and avoids a race with another queued render.
    if (params.unloadBeforeRun) {
      console.log(`[Queue] Releasing ComfyUI memory before comparison ${task.messageId}...`);
      try {
        await releaseComfyMemory(targetComfyUrl);
      } catch (err: unknown) {
        if (isComfyConnectionRefused(err)) throw new ComfyUnavailableError();
        throw new Error(`Unable to release ComfyUI memory: ${parseComfyError(err)}`);
      }
    }

    const workflow = getWorkflow(task.prompt, params);
    
    console.log(`[Queue] Submitting to ComfyUI at ${targetComfyUrl}...`);

    const backendDir = process.cwd().endsWith('backend') ? process.cwd() : path.join(process.cwd(), 'backend');
    const workflowFile = path.basename(params.workflowFile || 'workflow_lcm.json');
    const configPath = path.join(backendDir, 'workflows', workflowFile.replace(/\.json$/, '.config.json'));
    let saveNodeId = "99";
    let ksamplerNodeId = "10";
    if (fs.existsSync(configPath)) {
      try {
        const config: { nodeMapping?: { save?: string; ksampler?: string } } = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.nodeMapping?.save) saveNodeId = config.nodeMapping.save;
        if (config.nodeMapping?.ksampler) ksamplerNodeId = config.nodeMapping.ksampler;
      } catch (e) { /* use defaults */ }
    }

    const sampler: string = workflow[ksamplerNodeId]?.inputs?.sampler_name || '';
    const scheduler: string = workflow[ksamplerNodeId]?.inputs?.scheduler || '';

    let promptId = '';
    const submissionStartedAt = Date.now();
    writeAuditLog({
      source: 'comfyui',
      direction: 'outbound',
      event: 'comfy.prompt.request',
      message: 'Workflow envoyé à ComfyUI',
      status: 'sending',
      userId: sessionOwner?.userId,
      sessionId: task.sessionId,
      messageId: task.messageId,
      details: {
        targetUrl: targetComfyUrl,
        prompt: task.prompt,
        originalPrompt: task.originalPrompt,
        params,
        workflowNodes: Object.keys(workflow).length,
        saveNodeId,
        samplerNodeId: ksamplerNodeId
      }
    });
    try {
      const response = await axios.post(`${targetComfyUrl}/prompt`, { prompt: workflow, client_id: uuidv4() }, { timeout: 10000 });
      promptId = response.data.prompt_id;
      writeAuditLog({
        source: 'comfyui',
        direction: 'inbound',
        event: 'comfy.prompt.response',
        message: 'Workflow accepté par ComfyUI',
        status: 'accepted',
        durationMs: Date.now() - submissionStartedAt,
        userId: sessionOwner?.userId,
        sessionId: task.sessionId,
        messageId: task.messageId,
        details: { promptId, response: response.data }
      });
    } catch (err: unknown) { 
      if (isComfyConnectionRefused(err)) throw new ComfyUnavailableError();
      throw new Error(`Submission failed: ${parseComfyError(err)}`); 
    }

    let completedImage: ResolvedComfyHistoryImage | undefined;
    const startTime = generationStartedAt;
    const POLLING_TIMEOUT = 5 * 60 * 1000; 

    while (!completedImage) {
      if (Date.now() - startTime > POLLING_TIMEOUT) throw new Error('Generation timed out after 5 minutes.');
      
      const currentDuration = Math.floor((Date.now() - startTime) / 1000);
      db.prepare('UPDATE messages SET duration = ? WHERE id = ?')
        .run(currentDuration, task.messageId);
      broadcastToSession(task.sessionId, {
        messageId: task.messageId,
        status: 'processing',
        duration: currentDuration,
        generationStartedAt
      });

      let hResp;
      try { 
        hResp = await axios.get(`${targetComfyUrl}/history/${promptId}`, { timeout: 5000 }); 
      } catch (err: unknown) { 
        if (isComfyConnectionRefused(err)) throw new ComfyUnavailableError();
        console.warn(`[Queue] Polling attempt failed: ${(err as Error).message}`); 
        writeAuditLog({
          level: 'warning',
          source: 'comfyui',
          direction: 'inbound',
          event: 'comfy.history.retry',
          message: 'Lecture du statut ComfyUI échouée, nouvelle tentative',
          status: 'retrying',
          durationMs: currentDuration * 1000,
          userId: sessionOwner?.userId,
          sessionId: task.sessionId,
          messageId: task.messageId,
          details: { promptId, error: (err as Error).message }
        });
        await new Promise(r => setTimeout(r, 2000)); 
        continue; 
      }
      
      const history: ComfyHistoryEntry | undefined = hResp.data[promptId];
      if (history) {
        if (history.status?.status_str === 'error' || (history.status?.completed && !history.outputs)) {
          const errMsg = (history.status?.messages?.[0]?.[1] as { message?: string } | undefined)?.message || 'ComfyUI execution error';
          throw new Error(`Execution failed: ${errMsg}`);
        }
        completedImage = resolveComfyHistoryImage(history, saveNodeId);
      }
      
      if (!completedImage) {
        await new Promise(r => setTimeout(r, 1000));
        const stillExists = db.prepare('SELECT id FROM queue WHERE id = ?').get(task.id);
        if (!stillExists) { 
          isProcessingQueue = false; 
          setTimeout(processQueue, 100); 
          return; 
        }
      }
    }
    
    const finalDuration = Math.floor((Date.now() - startTime) / 1000);
    const { filename, subfolder = '', type = 'output', nodeId: outputNodeId } = completedImage;
    writeAuditLog({
      source: 'comfyui',
      direction: 'inbound',
      event: 'comfy.generation.completed',
      message: 'ComfyUI a terminé le rendu',
      status: 'completed',
      durationMs: finalDuration * 1000,
      userId: sessionOwner?.userId,
      sessionId: task.sessionId,
      messageId: task.messageId,
      details: { promptId, filename, subfolder, type, outputNodeId }
    });

    let imgResp;
    try {
      imgResp = await axios.get(`${targetComfyUrl}/view`, {
        params: { filename, subfolder, type },
        responseType: 'arraybuffer',
        timeout: 15000
      });
    } catch (err: unknown) { 
      if (isComfyConnectionRefused(err)) throw new ComfyUnavailableError();
      throw new Error(`Failed to retrieve image: ${parseComfyError(err)}`); 
    }
    
    const sessionRecord = db.prepare('SELECT userId FROM sessions WHERE id = ?').get(task.sessionId) as { userId: string } | undefined;
    const userId = sessionRecord?.userId || 'unknown';
    const userImagesDir = path.join(imagesDir, userId);
    const userThumbnailsDir = path.join(thumbnailsDir, userId);
    
    if (!fs.existsSync(userImagesDir)) fs.mkdirSync(userImagesDir, { recursive: true });
    if (!fs.existsSync(userThumbnailsDir)) fs.mkdirSync(userThumbnailsDir, { recursive: true });

    const baseName = `${Date.now()}-${filename.replace(/\.[^/.]+$/, "")}`;
    const fullWebpName = `${baseName}.webp`;
    const thumbWebpName = `${baseName}_thumb.webp`;
    
    await sharp(imgResp.data).webp({ quality: 85 }).toFile(path.join(userImagesDir, fullWebpName));
    await sharp(imgResp.data).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toFile(path.join(userThumbnailsDir, thumbWebpName));
    
    const imageUrl = `/api/image-files/${userId}/${fullWebpName}`;
    const thumbnailUrl = `/api/image-files/thumbnails/${userId}/${thumbWebpName}`;
    
    const completedAt = Date.now();
    db.prepare('UPDATE messages SET imageUrl = ?, thumbnailUrl = ?, status = ?, duration = ?, sampler = ?, scheduler = ? WHERE id = ?').run(imageUrl, thumbnailUrl, 'completed', finalDuration, sampler, scheduler, task.messageId);
    db.prepare('UPDATE sessions SET lastImageAt = ?, updatedAt = ? WHERE id = ?').run(completedAt, completedAt, task.sessionId);
    db.prepare('DELETE FROM queue WHERE id = ?').run(task.id);
    
    broadcastToSession(task.sessionId, { 
      messageId: task.messageId, 
      status: 'completed', 
      imageUrl, 
      thumbnailUrl, 
      duration: finalDuration,
      generationStartedAt,
      model: params.comfyModel, 
      width: params.width, 
      height: params.height, 
      steps: params.steps, 
      cfg: params.cfg, 
      workflow: params.workflowFile, 
      seed: params.seed,
      sampler,
      scheduler,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Unexpected error';
    console.error(`[Queue] Fatal error for task ${task?.messageId}:`, errorMsg);
    if (error instanceof ComfyUnavailableError) {
      const stoppedTasks = db.prepare(
        "SELECT * FROM queue WHERE status IN ('pending', 'processing') ORDER BY createdAt ASC"
      ).all() as QueueTask[];

      db.transaction(() => {
        const failMessage = db.prepare('UPDATE messages SET status = ?, text = ? WHERE id = ?');
        const deleteTask = db.prepare('DELETE FROM queue WHERE id = ?');
        for (const stoppedTask of stoppedTasks) {
          failMessage.run('failed', errorMsg, stoppedTask.messageId);
          deleteTask.run(stoppedTask.id);
        }
      })();

      console.error(`[Queue] ComfyUI unavailable; stopped ${stoppedTasks.length} queued generation(s).`);
      for (const stoppedTask of stoppedTasks) {
        const failedOwner = db.prepare('SELECT userId FROM sessions WHERE id = ?').get(stoppedTask.sessionId) as { userId: string } | undefined;
        broadcastToSession(stoppedTask.sessionId, {
          messageId: stoppedTask.messageId,
          status: 'failed',
          error: errorMsg,
          serviceUnavailable: true,
          stopAll: true
        });
        writeAuditLog({
          level: 'error',
          source: 'comfyui',
          direction: 'inbound',
          event: 'comfy.generation.failed',
          message: errorMsg,
          status: 'failed',
          userId: failedOwner?.userId,
          sessionId: stoppedTask.sessionId,
          messageId: stoppedTask.messageId,
          details: { queueId: stoppedTask.id, reason: 'ECONNREFUSED', queueStopped: true }
        });
      }
    } else if (task) {
      const failedOwner = db.prepare('SELECT userId FROM sessions WHERE id = ?').get(task.sessionId) as { userId: string } | undefined;
      db.prepare('UPDATE messages SET status = ?, text = ? WHERE id = ?').run('failed', errorMsg, task.messageId);
      db.prepare('DELETE FROM queue WHERE id = ?').run(task.id);
      broadcastToSession(task.sessionId, { messageId: task.messageId, status: 'failed', error: errorMsg });
      writeAuditLog({
        level: 'error',
        source: 'comfyui',
        direction: 'inbound',
        event: 'comfy.generation.failed',
        message: errorMsg,
        status: 'failed',
        userId: failedOwner?.userId,
        sessionId: task.sessionId,
        messageId: task.messageId,
        details: { queueId: task.id, prompt: task.prompt, params: task.params }
      });
    }
  } finally { 
    isProcessingQueue = false; 
    setTimeout(processQueue, 500); 
  }
};

export const initQueue = (wsServer: WebSocketServer) => {
  setWss(wsServer);
  db.prepare("UPDATE queue SET status = 'pending' WHERE status = 'processing'").run();
  db.prepare("UPDATE messages SET status = 'pending', generationStartedAt = NULL WHERE status = 'processing' AND id IN (SELECT messageId FROM queue)").run();
  processQueue();
  setInterval(processQueue, 2000);
};
