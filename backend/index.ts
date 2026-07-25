import 'dotenv/config';
import http from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { createApp } from './src/app';
import { initQueue } from './src/services/queue';
import { attachAuthenticatedWebSocket } from './src/websocket';

// Restore default workflows if obscured by empty volume mount
const backendDir = process.cwd().endsWith('backend') ? process.cwd() : path.join(process.cwd(), 'backend');
const workflowsDir = path.join(backendDir, 'workflows');
const defaultWorkflowsDir = path.join(backendDir, 'default_workflows');

if (fs.existsSync(defaultWorkflowsDir) && fs.existsSync(workflowsDir)) {
  const defaultFiles = fs.readdirSync(defaultWorkflowsDir);
  for (const file of defaultFiles) {
    const targetPath = path.join(workflowsDir, file);
    if (!fs.existsSync(targetPath)) {
      try {
        fs.copyFileSync(path.join(defaultWorkflowsDir, file), targetPath);
        console.log(`[Init] Restored default workflow file: ${file}`);
      } catch (err) {
        console.error(`[Init] Failed to restore default workflow file: ${file}`, err);
      }
    }
  }
}

const PORT = Number(process.env.PORT) || 3001;
const AUTH_SECRET = process.env.AUTH_SECRET;
if (!AUTH_SECRET || AUTH_SECRET.length < 32) {
  console.error('[Fatal] AUTH_SECRET must contain at least 32 characters.');
  process.exit(1);
}

const app = createApp(AUTH_SECRET);
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
initQueue(wss);
attachAuthenticatedWebSocket(server, wss, AUTH_SECRET);

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('[Fatal] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Fatal] Unhandled Rejection at:', promise, 'reason:', reason);
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
