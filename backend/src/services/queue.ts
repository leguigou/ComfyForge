import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { WebSocket, WebSocketServer } from 'ws';
import db from './database';
import { getTargetComfyUrl, getWorkflow, parseComfyError } from './comfy';
import { imagesDir, thumbnailsDir } from './image';
import { QueueTask, GenerationParams, ComfyHistoryEntry } from '../types';

let isProcessingQueue = false;
let wss: WebSocketServer | null = null;
const websocketUsers = new WeakMap<WebSocket, string>();

export const setWss = (wsServer: WebSocketServer) => {
  wss = wsServer;
};

export const registerWebSocketUser = (client: WebSocket, userId: string) => {
  websocketUsers.set(client, userId);
};

export const broadcastToSession = (sessionId: string, data: Record<string, unknown>) => {
  if (!wss) return;
  const session = db.prepare('SELECT userId FROM sessions WHERE id = ?').get(sessionId) as { userId: string } | undefined;
  if (!session) return;

  const payload = JSON.stringify({ type: 'queue_update', sessionId, ...data });
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
    db.prepare('UPDATE queue SET status = ? WHERE id = ?').run('processing', task.id);
    db.prepare('UPDATE messages SET status = ? WHERE id = ?').run('processing', task.messageId);
    broadcastToSession(task.sessionId, { messageId: task.messageId, status: 'processing' });

    const params: GenerationParams = JSON.parse(task.params);
    const workflow = getWorkflow(task.prompt, params);
    const targetComfyUrl = getTargetComfyUrl(params.comfyUrl);
    
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
    try {
      const response = await axios.post(`${targetComfyUrl}/prompt`, { prompt: workflow, client_id: uuidv4() }, { timeout: 10000 });
      promptId = response.data.prompt_id;
    } catch (err: unknown) { 
      throw new Error(`Submission failed: ${parseComfyError(err)}`); 
    }

    let finished = false, filename = '';
    const startTime = Date.now();
    const POLLING_TIMEOUT = 5 * 60 * 1000; 

    while (!finished) {
      if (Date.now() - startTime > POLLING_TIMEOUT) throw new Error('Generation timed out after 5 minutes.');
      
      const currentDuration = Math.floor((Date.now() - startTime) / 1000);
      broadcastToSession(task.sessionId, { messageId: task.messageId, status: 'processing', duration: currentDuration });

      let hResp;
      try { 
        hResp = await axios.get(`${targetComfyUrl}/history/${promptId}`, { timeout: 5000 }); 
      } catch (err: unknown) { 
        console.warn(`[Queue] Polling attempt failed: ${(err as Error).message}`); 
        await new Promise(r => setTimeout(r, 2000)); 
        continue; 
      }
      
      const history: ComfyHistoryEntry | undefined = hResp.data[promptId];
      if (history) {
        if (history.status?.status_str === 'error' || (history.status?.completed && !history.outputs)) {
          const errMsg = (history.status?.messages?.[0]?.[1] as { message?: string } | undefined)?.message || 'ComfyUI execution error';
          throw new Error(`Execution failed: ${errMsg}`);
        }
        const nodeOutput = history.outputs?.[saveNodeId];
        if (nodeOutput?.images?.length) {
          filename = String(nodeOutput.images[0].filename);
          finished = true;
        }
      }
      
      if (!finished) {
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

    let imgResp;
    try {
      imgResp = await axios.get(`${targetComfyUrl}/view`, { params: { filename }, responseType: 'arraybuffer', timeout: 15000 });
    } catch (err: unknown) { 
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
    if (task) {
      db.prepare('UPDATE messages SET status = ?, text = ? WHERE id = ?').run('failed', errorMsg, task.messageId);
      db.prepare('DELETE FROM queue WHERE id = ?').run(task.id);
      broadcastToSession(task.sessionId, { messageId: task.messageId, status: 'failed', error: errorMsg });
    }
  } finally { 
    isProcessingQueue = false; 
    setTimeout(processQueue, 500); 
  }
};

export const initQueue = (wsServer: WebSocketServer) => {
  setWss(wsServer);
  db.prepare("UPDATE queue SET status = 'pending' WHERE status = 'processing'").run();
  db.prepare("UPDATE messages SET status = 'pending' WHERE status = 'processing' AND id IN (SELECT messageId FROM queue)").run();
  processQueue();
  setInterval(processQueue, 2000);
};
