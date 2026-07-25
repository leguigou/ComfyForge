import http from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import db from './services/database';
import { registerWebSocketUser } from './services/queue';
import { isAllowedOrigin } from './security/origin';
import { getSignedUserId } from './security/websocket';

const rejectUpgrade = (socket: NodeJS.WritableStream, status: number, message: string) => {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  if ('destroy' in socket && typeof socket.destroy === 'function') socket.destroy();
};

export const attachAuthenticatedWebSocket = (
  server: http.Server,
  wss: WebSocketServer,
  authSecret: string
) => {
  server.on('upgrade', (request, socket, head) => {
    const pathname = (request.url || '').split('?')[0];
    if (pathname !== '/api/ws' && pathname !== '/ws') {
      return rejectUpgrade(socket, 404, 'Not Found');
    }

    const forwardedHost = request.headers['x-forwarded-host'];
    const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || request.headers.host;
    const forwardedProto = request.headers['x-forwarded-proto'];
    const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
      || ((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted ? 'https' : 'http');

    if (!isAllowedOrigin(request.headers.origin, host, protocol)) {
      return rejectUpgrade(socket, 403, 'Forbidden');
    }

    const userId = getSignedUserId(request.headers.cookie, authSecret);
    const user = userId
      ? db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as { id: string } | undefined
      : undefined;

    if (!user) {
      return rejectUpgrade(socket, 401, 'Unauthorized');
    }

    wss.handleUpgrade(request, socket, head, ws => {
      registerWebSocketUser(ws, user.id);
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'connected', clientId: uuidv4() }));
  });
};
