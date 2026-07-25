import fs from 'fs';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RawData, WebSocket, WebSocketServer } from 'ws';

const authSecret = 'test-auth-secret-with-more-than-32-characters';
const runtimeDir = path.join(process.cwd(), '.test-runtime', `api-${process.pid}`);
const databasePath = path.join(runtimeDir, 'history.db');
const imagesDir = path.join(runtimeDir, 'images');

let server: http.Server;
let websocketServer: WebSocketServer;
let baseUrl: string;
let db: typeof import('../services/database').default;
let adminCookie: string;
let adminId: string;
let adminSessionId: string;

const request = async (
  pathname: string,
  options: RequestInit & { cookie?: string; origin?: string } = {}
) => {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set('Cookie', options.cookie);
  if (options.origin) headers.set('Origin', options.origin);
  if (options.body) headers.set('Content-Type', 'application/json');

  return fetch(`${baseUrl}${pathname}`, { ...options, headers });
};

const json = async (response: Response) => response.json() as Promise<Record<string, any>>;
const authCookieFrom = (response: Response) => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  const authCookie = [...values].reverse().find(value => value.startsWith('userId=') && !value.includes('Max-Age=0'));
  return authCookie?.split(';')[0] || '';
};

beforeAll(async () => {
  fs.mkdirSync(imagesDir, { recursive: true });
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = databasePath;
  process.env.IMAGES_DIR = imagesDir;
  process.env.APP_PASSWORD = 'test-admin-password';
  process.env.COMFY_URL = 'http://127.0.0.1:8188';
  delete process.env.CORS_ORIGINS;
  delete process.env.SERVICE_URL_ALLOWLIST;
  delete process.env.ALLOW_PRIVATE_SERVICE_URLS;

  const [{ createApp }, databaseModule] = await Promise.all([
    import('../app'),
    import('../services/database'),
  ]);
  db = databaseModule.default;

  server = http.createServer(createApp(authSecret));
  websocketServer = new WebSocketServer({ noServer: true });
  const { attachAuthenticatedWebSocket } = await import('../websocket');
  attachAuthenticatedWebSocket(server, websocketServer, authSecret);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  const loginResponse = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'test-admin-password' }),
  });
  if (!loginResponse.ok) {
    throw new Error(`Test admin login failed (${loginResponse.status}): ${await loginResponse.text()}`);
  }
  adminCookie = authCookieFrom(loginResponse);
  const { getSignedUserId } = await import('./websocket');
  if (!getSignedUserId(adminCookie, authSecret)) {
    throw new Error('Test login did not return a valid signed cookie');
  }
  const usersResponse = await request('/api/users', { cookie: adminCookie });
  if (!usersResponse.ok) {
    throw new Error(`Test admin lookup failed (${usersResponse.status}): ${await usersResponse.text()}`);
  }
  const users = await usersResponse.json() as Array<{ id: string }>;
  adminId = users[0].id;
  const sessionResponse = await request('/api/history', { method: 'POST', cookie: adminCookie });
  adminSessionId = ((await sessionResponse.json()) as { id: string }).id;
});

afterAll(async () => {
  websocketServer.clients.forEach(client => client.close());
  await new Promise<void>(resolve => websocketServer.close(() => resolve()));
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  const testRuntimeRoot = path.dirname(runtimeDir);
  if (fs.existsSync(testRuntimeRoot) && fs.readdirSync(testRuntimeRoot).length === 0) {
    fs.rmdirSync(testRuntimeRoot);
  }
});

describe('API security boundaries', () => {
  it('rejects a cross-origin request instead of reflecting arbitrary origins', async () => {
    const response = await request('/api/auth/logout', {
      method: 'POST',
      cookie: adminCookie,
      origin: 'https://evil.example',
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('accepts the actual same origin including its forwarded port', async () => {
    const response = await request('/api/auth/logout', {
      method: 'POST',
      cookie: adminCookie,
      origin: baseUrl,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(baseUrl);
  });

  it('rejects service URLs outside the explicit allowlist without making a request', async () => {
    const response = await request('/api/llm/check', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ llmUrl: 'http://169.254.169.254' }),
    });

    expect(response.status).toBe(403);
    expect((await json(response)).error).toContain('SERVICE_URL_ALLOWLIST');
  });

  it('supports per-user LLM URLs only when explicitly enabled', async () => {
    const { validateServiceUrl } = await import('./service-url');
    process.env.ALLOW_USER_LLM_URLS = 'true';

    try {
      expect(validateServiceUrl('http://192.0.2.10:1234', 'LLM')).toBe('http://192.0.2.10:1234');
      expect(() => validateServiceUrl('ftp://192.0.2.10', 'LLM')).toThrow('Invalid LLM URL');
      expect(() => validateServiceUrl('http://user:password@192.0.2.10:1234', 'LLM')).toThrow('Invalid LLM URL');
    } finally {
      delete process.env.ALLOW_USER_LLM_URLS;
    }
  });

  it('allows literal private network service URLs only when explicitly enabled', async () => {
    const { validateServiceUrl } = await import('./service-url');
    process.env.ALLOW_PRIVATE_SERVICE_URLS = 'true';

    try {
      expect(validateServiceUrl('http://127.0.0.1:51234', 'LLM')).toBe('http://127.0.0.1:51234');
      expect(validateServiceUrl('http://10.20.30.40:1234', 'LLM')).toBe('http://10.20.30.40:1234');
      expect(validateServiceUrl('http://172.31.0.5:1234', 'LLM')).toBe('http://172.31.0.5:1234');
      expect(validateServiceUrl('http://192.168.0.40:1234', 'LLM')).toBe('http://192.168.0.40:1234');
      expect(validateServiceUrl('http://[::1]:1234', 'LLM')).toBe('http://[::1]:1234');
      expect(validateServiceUrl('http://[fd00::40]:1234', 'LLM')).toBe('http://[fd00::40]:1234');
      expect(() => validateServiceUrl('http://169.254.169.254', 'LLM')).toThrow('SERVICE_URL_ALLOWLIST');
      expect(() => validateServiceUrl('https://example.com', 'LLM')).toThrow('SERVICE_URL_ALLOWLIST');
    } finally {
      delete process.env.ALLOW_PRIVATE_SERVICE_URLS;
    }
  });

  it('does not delete another user session or its files', async () => {
    const victimSessionResponse = await request('/api/history', {
      method: 'POST',
      cookie: adminCookie,
    });
    const victimSession = await victimSessionResponse.json() as { id: string };

    await request('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ username: 'attacker', password: 'attacker-password' }),
    });
    const attackerLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'attacker', password: 'attacker-password' }),
    });
    const attackerCookie = authCookieFrom(attackerLogin);

    const victimDir = path.join(imagesDir, adminId);
    fs.mkdirSync(victimDir, { recursive: true });
    const victimFile = path.join(victimDir, 'victim.webp');
    fs.writeFileSync(victimFile, 'test-image');
    db.prepare(`
      INSERT INTO messages (id, sessionId, role, imageUrl, timestamp, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'victim-message',
      victimSession.id,
      'bot',
      `/api/image-files/${adminId}/victim.webp`,
      Date.now(),
      'completed'
    );

    const attackResponse = await request(`/api/history/${victimSession.id}`, {
      method: 'DELETE',
      cookie: attackerCookie,
    });

    expect(attackResponse.status).toBe(404);
    expect(fs.existsSync(victimFile)).toBe(true);
    expect(db.prepare('SELECT id FROM sessions WHERE id = ?').get(victimSession.id)).toBeTruthy();

    const ownerResponse = await request(`/api/history/${victimSession.id}`, {
      method: 'DELETE',
      cookie: adminCookie,
    });
    expect(ownerResponse.status).toBe(200);
    expect(fs.existsSync(victimFile)).toBe(false);
  });

  it('accepts the signed login cookie and rejects a forged WebSocket cookie', async () => {
    const { getSignedUserId } = await import('./websocket');

    expect(getSignedUserId(adminCookie, authSecret)).toBe(adminId);
    expect(getSignedUserId(`userId=${adminId}`, authSecret)).toBeNull();
  });

  it('rejects anonymous WebSockets and accepts the signed session cookie', async () => {
    const websocketUrl = baseUrl.replace(/^http/, 'ws') + '/api/ws';
    const anonymousStatus = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(websocketUrl, { headers: { Origin: baseUrl } });
      socket.once('unexpected-response', (_request, response) => resolve(response.statusCode || 0));
      socket.once('open', () => reject(new Error('Anonymous WebSocket unexpectedly opened')));
      socket.once('error', () => {});
    });

    expect(anonymousStatus).toBe(401);

    const connectedMessage = await new Promise<Record<string, string>>((resolve, reject) => {
      const socket = new WebSocket(websocketUrl, {
        headers: { Origin: baseUrl, Cookie: adminCookie },
      });
      socket.once('message', (data: RawData) => {
        resolve(JSON.parse(data.toString()));
        socket.close();
      });
      socket.once('error', reject);
    });

    expect(connectedMessage.type).toBe('connected');
    expect(connectedMessage.clientId).toBeTruthy();
  });

  it('broadcasts queue updates only to clients owned by the session user', async () => {
    const queue = await import('../services/queue');
    const ownerSend = vi.fn();
    const otherSend = vi.fn();
    const ownerClient = { readyState: WebSocket.OPEN, send: ownerSend } as unknown as WebSocket;
    const otherClient = { readyState: WebSocket.OPEN, send: otherSend } as unknown as WebSocket;
    const fakeServer = {
      clients: new Set([ownerClient, otherClient]),
    } as unknown as WebSocketServer;

    queue.setWss(fakeServer);
    queue.registerWebSocketUser(ownerClient, adminId);
    queue.registerWebSocketUser(otherClient, 'another-user');

    queue.broadcastToSession(adminSessionId, { status: 'completed' });

    expect(ownerSend).toHaveBeenCalledOnce();
    expect(otherSend).not.toHaveBeenCalled();
  });
});
