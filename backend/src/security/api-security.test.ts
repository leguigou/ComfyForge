import fs from 'fs';
import http from 'http';
import path from 'path';
import axios from 'axios';
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
  it('exposes a minimal public health contract without checking ComfyUI', async () => {
    const response = await request('/api/health?dependencies=0');
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.database.status).toBe('available');
    expect(body.database.schemaVersion).toBe(body.database.expectedSchemaVersion);
    expect(body.comfy.status).toBe('not_checked');
  });

  it('paginates the gallery with a stable timestamp and id cursor', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `cursor-gallery-${index.toString().padStart(2, '0')}`);
    try {
      const insert = db.prepare(`
        INSERT INTO messages (id, sessionId, role, text, prompt, imageUrl, timestamp, status)
        VALUES (?, ?, 'bot', '', ?, ?, ?, 'completed')
      `);
      db.transaction(() => ids.forEach((id, index) => {
        insert.run(id, adminSessionId, `Prompt ${index}`, `/api/image-files/${id}.png`, 10_000 + index);
      }))();

      const firstResponse = await request('/api/gallery?limit=5&includeTotal=true', { cookie: adminCookie });
      const first = await json(firstResponse);
      expect(firstResponse.status).toBe(200);
      expect(first.items).toHaveLength(5);
      expect(first.nextCursor).toBeTruthy();

      const cursor = new URLSearchParams({
        limit: '5',
        includeTotal: 'true',
        cursorTimestamp: String(first.nextCursor.timestamp),
        cursorId: String(first.nextCursor.id)
      });
      const secondResponse = await request(`/api/gallery?${cursor}`, { cookie: adminCookie });
      const second = await json(secondResponse);
      const firstIds = new Set(first.items.map((item: { messageId: string }) => item.messageId));
      expect(secondResponse.status).toBe(200);
      expect(second.items).toHaveLength(5);
      expect(second.items.every((item: { messageId: string }) => !firstIds.has(item.messageId))).toBe(true);

      const searchResponse = await request('/api/gallery?limit=5&includeTotal=true&search=Prompt%2011', { cookie: adminCookie });
      const search = await json(searchResponse);
      expect(searchResponse.status).toBe(200);
      expect(search.items.map((item: { messageId: string }) => item.messageId)).toContain('cursor-gallery-11');
    } finally {
      db.prepare(`DELETE FROM messages WHERE id LIKE 'cursor-gallery-%'`).run();
    }
  });

  it('paginates comparison sources without duplicates', async () => {
    const sourceIds = Array.from({ length: 7 }, (_, index) => `comparison-cursor-source-${index}`);
    const versionIds = Array.from({ length: 7 }, (_, index) => `comparison-cursor-version-${index}`);
    try {
      const insert = db.prepare(`
        INSERT INTO messages (
          id, sessionId, role, text, prompt, imageUrl, timestamp, status, comparisonSourceId
        ) VALUES (?, ?, 'bot', '', ?, ?, ?, 'completed', ?)
      `);
      db.transaction(() => sourceIds.forEach((sourceId, index) => {
        insert.run(
          sourceId,
          adminSessionId,
          `Source ${index}`,
          `/api/image-files/${sourceId}.png`,
          20_000 + index,
          null
        );
        insert.run(
          versionIds[index],
          adminSessionId,
          `Version ${index}`,
          `/api/image-files/${versionIds[index]}.png`,
          30_000 + index,
          sourceId
        );
      }))();

      const firstResponse = await request('/api/comparisons?limit=3', { cookie: adminCookie });
      const first = await json(firstResponse);
      expect(firstResponse.status).toBe(200);
      expect(first.items).toHaveLength(3);
      expect(first.nextCursor).toBeTruthy();

      const cursor = new URLSearchParams({
        limit: '3',
        cursorLatestAt: String(first.nextCursor.latestAt),
        cursorId: String(first.nextCursor.id)
      });
      const secondResponse = await request(`/api/comparisons?${cursor}`, { cookie: adminCookie });
      const second = await json(secondResponse);
      const firstIds = new Set(first.items.map((item: { messageId: string }) => item.messageId));
      expect(secondResponse.status).toBe(200);
      expect(second.items).toHaveLength(3);
      expect(second.items.every((item: { messageId: string }) => !firstIds.has(item.messageId))).toBe(true);
      expect(second.nextCursor).toBeTruthy();

      const finalCursor = new URLSearchParams({
        limit: '3',
        cursorLatestAt: String(second.nextCursor.latestAt),
        cursorId: String(second.nextCursor.id)
      });
      const finalResponse = await request(`/api/comparisons?${finalCursor}`, { cookie: adminCookie });
      const finalPage = await json(finalResponse);
      expect(finalPage.items).toHaveLength(1);
      expect(finalPage.nextCursor).toBeNull();
    } finally {
      db.prepare(`DELETE FROM messages WHERE id LIKE 'comparison-cursor-%'`).run();
    }
  });

  it('lets an administrator inspect and cancel a pending queue item', async () => {
    const messageId = 'admin-queue-test-message';
    let queueId: number | undefined;
    try {
      db.prepare(`
        INSERT INTO messages (id, sessionId, role, text, prompt, timestamp, status)
        VALUES (?, ?, 'bot', '', 'Queued prompt', ?, 'pending')
      `).run(messageId, adminSessionId, Date.now());
      const result = db.prepare(`
        INSERT INTO queue (messageId, userId, prompt, originalPrompt, sessionId, params, status, createdAt)
        VALUES (?, ?, ?, ?, ?, '{}', 'pending', ?)
      `).run(messageId, adminId, 'Queued prompt', 'Queued prompt', adminSessionId, Date.now());
      queueId = Number(result.lastInsertRowid);

      const listResponse = await request('/api/admin/queue', { cookie: adminCookie });
      const list = await json(listResponse);
      expect(listResponse.status).toBe(200);
      expect(list.items.some((item: { id: number }) => item.id === queueId)).toBe(true);
      expect(list.perUser.some((item: { userId: string }) => item.userId === adminId)).toBe(true);

      const deleteResponse = await request(`/api/admin/queue/${queueId}`, {
        method: 'DELETE',
        cookie: adminCookie
      });
      expect(deleteResponse.status).toBe(200);
      expect(db.prepare('SELECT id FROM queue WHERE id = ?').get(queueId)).toBeUndefined();
      expect((db.prepare('SELECT status FROM messages WHERE id = ?').get(messageId) as { status: string }).status)
        .toBe('failed');
    } finally {
      if (queueId) db.prepare('DELETE FROM queue WHERE id = ?').run(queueId);
      db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
    }
  });

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

  it('accepts legacy large generation payloads but keeps the global JSON limit', async () => {
    const oversizedData = 'x'.repeat(2_100_000);
    const legacyResponse = await request('/api/generate/generate', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({
        prompt: 'Payload compatibility probe',
        originalPrompt: 'Payload compatibility probe',
        sessionId: 'invalid-session',
        params: { randomPromptLists: [oversizedData] }
      })
    });
    expect(legacyResponse.status).toBe(403);
    expect(legacyResponse.headers.get('content-type')).toContain('application/json');

    const limitedResponse = await request('/api/auth/logout', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ oversizedData })
    });
    const limitedBody = await json(limitedResponse);
    expect(limitedResponse.status).toBe(413);
    expect(limitedResponse.headers.get('content-type')).toContain('application/json');
    expect(limitedBody.code).toBe('PAYLOAD_TOO_LARGE');
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

  it('externalizes legacy companion sprites and isolates their files by user', async () => {
    const username = 'companion-owner';
    const createResponse = await request('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ username, password: 'companion-owner-password' }),
    });
    const ownerId = (await json(createResponse)).id as string;
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'companion-owner-password' }),
    });
    const ownerCookie = authCookieFrom(login);
    const spriteDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const legacySettings = {
      width: 896,
      companionSettings: {
        enabled: true,
        activeId: 'companion-two',
        companions: [
          { id: 'seedy-default', name: 'Seedy', source: 'builtin' },
          { id: 'companion-one', name: 'Pixel', source: 'custom', spriteDataUrl },
          { id: 'companion-two', name: 'Nova', source: 'custom', spriteDataUrl },
        ],
      },
    };

    try {
      db.prepare('INSERT INTO user_settings (userId, data, updatedAt) VALUES (?, ?, ?)')
        .run(ownerId, JSON.stringify(legacySettings), Date.now());

      const settingsResponse = await request('/api/settings', { cookie: ownerCookie });
      const savedSettings = await json(settingsResponse);
      expect(settingsResponse.status).toBe(200);
      expect(savedSettings.companionSettings.companions).toHaveLength(3);
      expect(savedSettings.companionSettings.activeId).toBe('companion-two');
      expect(savedSettings.companionSettings.companions[2].spriteDataUrl).toBeUndefined();
      expect(savedSettings.companionSettings.companions[2].spriteUrl).toBe('/api/companions/companion-two');
      expect((db.prepare('SELECT length(data) AS bytes FROM user_settings WHERE userId = ?').get(ownerId) as { bytes: number }).bytes)
        .toBeLessThan(2_000);

      const assetResponse = await request('/api/companions/companion-two', { cookie: ownerCookie });
      expect(assetResponse.status, await assetResponse.clone().text()).toBe(200);
      expect(assetResponse.headers.get('content-type')).toContain('image/png');
      expect((await assetResponse.arrayBuffer()).byteLength).toBeGreaterThan(50);
      expect((await request('/api/companions/companion-two')).status).toBe(401);
      expect((await request('/api/companions/companion-two', { cookie: adminCookie })).status).toBe(404);

      savedSettings.companionSettings.companions = savedSettings.companionSettings.companions
        .filter((companion: { id: string }) => companion.id !== 'companion-two');
      savedSettings.companionSettings.activeId = 'companion-one';
      const cleanupResponse = await request('/api/settings', {
        method: 'POST',
        cookie: ownerCookie,
        body: JSON.stringify(savedSettings),
      });
      expect(cleanupResponse.status).toBe(200);
      expect((await request('/api/companions/companion-two', { cookie: ownerCookie })).status).toBe(404);

      const uploadResponse = await request('/api/companions/companion-three', {
        method: 'POST',
        cookie: ownerCookie,
        body: JSON.stringify({ spriteDataUrl }),
      });
      const upload = await json(uploadResponse);
      expect(uploadResponse.status).toBe(201);
      expect(upload.profile.spriteUrl).toBe('/api/companions/companion-three');
    } finally {
      await request(`/api/users/${ownerId}`, { method: 'DELETE', cookie: adminCookie });
    }
  });

  it('persists an LLM prompt as retryable before image generation is queued', async () => {
    const { encryptApiKey } = await import('../services/llm-providers');
    const providerId = 'recovery-test-provider';
    const now = Date.now();
    db.prepare(`
      INSERT INTO llm_providers (
        id, userId, name, type, baseUrl, model, apiKey, isActive, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      providerId,
      adminId,
      'Recovery test',
      'openai',
      'https://llm.example.test',
      'test-model',
      encryptApiKey('test-api-key'),
      1,
      now,
      now,
    );

    const llmResponse = {
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              positive: 'Recovered enhanced prompt',
              negative: 'Recovered negative prompt',
            }),
          },
        }],
      },
    };
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce(llmResponse);
    try {
      const response = await request('/api/llm/enhance-prompt', {
        method: 'POST',
        cookie: adminCookie,
        body: JSON.stringify({
          prompt: 'Original recovery prompt',
          originalPrompt: 'Original recovery prompt',
          sessionId: adminSessionId,
          providerId,
          params: {
            comfyModel: 'test-model.safetensors',
            workflowFile: 'workflow_lcm.json',
            width: 768,
            height: 1024,
            negativePrompt: 'Initial negative prompt',
          },
        }),
      });
      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.recoveryMessageId).toBeTruthy();

      const recovered = db.prepare(`
        SELECT status, prompt, generationPrompt, generationParams
        FROM messages
        WHERE id = ?
      `).get(body.recoveryMessageId) as {
        status: string;
        prompt: string;
        generationPrompt: string;
        generationParams: string;
      };
      expect(recovered.status).toBe('failed');
      expect(recovered.prompt).toBe('Original recovery prompt');
      expect(recovered.generationPrompt).toBe('Recovered enhanced prompt');
      expect(JSON.parse(recovered.generationParams).negativePrompt).toBe('Recovered negative prompt');
      expect(db.prepare('SELECT id FROM queue WHERE messageId = ?').get(body.recoveryMessageId)).toBeUndefined();

      postSpy.mockRejectedValueOnce(new Error('LLM unavailable'));
      const failedResponse = await request('/api/llm/enhance-prompt', {
        method: 'POST',
        cookie: adminCookie,
        body: JSON.stringify({
          prompt: 'Prompt saved before a failed LLM call',
          sessionId: adminSessionId,
          providerId,
          params: { workflowFile: 'workflow_lcm.json' },
        }),
      });
      expect(failedResponse.status).toBe(502);
      const failedBody = await json(failedResponse);
      expect(failedBody.recoveryMessageId).toBeTruthy();
      const failedRecovery = db.prepare(`
        SELECT status, generationPrompt
        FROM messages
        WHERE id = ?
      `).get(failedBody.recoveryMessageId) as { status: string; generationPrompt: string };
      expect(failedRecovery.status).toBe('failed');
      expect(failedRecovery.generationPrompt).toBe('Prompt saved before a failed LLM call');
    } finally {
      postSpy.mockRestore();
    }
  });

  it('isolates admin logs by administrator account', async () => {
    await request('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ username: 'admin-two', password: 'admin-two-password', isAdmin: true }),
    });
    await request('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ username: 'log-viewer', password: 'log-viewer-password', isAdmin: false }),
    });

    const secondAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin-two') as { id: string };
    const { writeAuditLog } = await import('../services/audit-log');
    writeAuditLog({
      source: 'comfyui',
      direction: 'outbound',
      event: 'test.owner',
      message: 'visible-only-to-first-admin',
      userId: adminId,
      details: { password: 'admin-two-password', apiKey: 'log-viewer-password' }
    });
    db.prepare(`
      INSERT INTO audit_logs (timestamp, level, source, event, message, userId)
      VALUES (?, 'error', 'llm', 'test.owner', ?, ?)
    `).run(Date.now(), 'visible-only-to-second-admin', secondAdmin.id);

    const secondLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin-two', password: 'admin-two-password' }),
    });
    const viewerLogin = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'log-viewer', password: 'log-viewer-password' }),
    });

    const firstLogs = await json(await request('/api/admin/logs', { cookie: adminCookie }));
    const secondLogs = await json(await request('/api/admin/logs', { cookie: authCookieFrom(secondLogin) }));
    const forbidden = await request('/api/admin/logs', { cookie: authCookieFrom(viewerLogin) });

    expect(firstLogs.logs.some((log: { message: string }) => log.message === 'visible-only-to-first-admin')).toBe(true);
    expect(firstLogs.logs.some((log: { message: string }) => log.message === 'visible-only-to-second-admin')).toBe(false);
    expect(JSON.stringify(firstLogs)).not.toContain('admin-two-password');
    expect(JSON.stringify(firstLogs)).not.toContain('log-viewer-password');
    expect(secondLogs.logs.some((log: { message: string }) => log.message === 'visible-only-to-second-admin')).toBe(true);
    expect(secondLogs.logs.some((log: { message: string }) => log.message === 'visible-only-to-first-admin')).toBe(false);
    expect(forbidden.status).toBe(403);
  });

  it('purges audit logs older than five days', async () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO audit_logs (timestamp, level, source, event, message, userId)
      VALUES (?, 'info', 'backend', 'test.retention', 'expired-log', ?)
    `).run(now - 6 * 24 * 60 * 60 * 1000, adminId);
    db.prepare(`
      INSERT INTO audit_logs (timestamp, level, source, event, message, userId)
      VALUES (?, 'info', 'backend', 'test.retention', 'recent-log', ?)
    `).run(now - 4 * 24 * 60 * 60 * 1000, adminId);

    const { purgeExpiredAuditLogs } = await import('../services/audit-log');
    expect(purgeExpiredAuditLogs(now)).toBeGreaterThanOrEqual(1);
    expect(db.prepare('SELECT id FROM audit_logs WHERE message = ?').get('expired-log')).toBeUndefined();
    expect(db.prepare('SELECT id FROM audit_logs WHERE message = ?').get('recent-log')).toBeTruthy();
  });

  it('paginates long histories and compresses their JSON response', async () => {
    const sessionId = 'paginated-history-session';
    db.prepare(`
      INSERT INTO sessions (id, userId, title, updatedAt, isArchived)
      VALUES (?, ?, 'Paginated history', ?, 0)
    `).run(sessionId, adminId, Date.now());
    const insertMessage = db.prepare(`
      INSERT INTO messages (id, sessionId, role, text, timestamp, status)
      VALUES (?, ?, 'bot', ?, ?, 'completed')
    `);
    db.transaction(() => {
      for (let index = 0; index < 65; index++) {
        insertMessage.run(
          `page-message-${String(index).padStart(2, '0')}`,
          sessionId,
          `Message ${index} ${'content '.repeat(20)}`,
          10_000 + index
        );
      }
    })();

    const firstResponse = await request(`/api/history/${sessionId}?limit=60`, {
      cookie: adminCookie,
      headers: { 'Accept-Encoding': 'gzip' },
    });
    const firstPage = await json(firstResponse);
    expect(firstResponse.headers.get('content-encoding')).toBe('gzip');
    expect(firstPage.messages).toHaveLength(60);
    expect(firstPage.messages[0].id).toBe('page-message-05');
    expect(firstPage.hasMore).toBe(true);

    const cursor = firstPage.nextCursor as { timestamp: number; id: string };
    const secondResponse = await request(
      `/api/history/${sessionId}?limit=60&beforeTimestamp=${cursor.timestamp}&beforeId=${cursor.id}`,
      { cookie: adminCookie }
    );
    const secondPage = await json(secondResponse);
    expect(secondPage.messages).toHaveLength(5);
    expect(secondPage.messages[0].id).toBe('page-message-00');
    expect(secondPage.hasMore).toBe(false);

    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  });

  it('deletes active sessions, archives, or both according to the selected scope', async () => {
    await request('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: JSON.stringify({ username: 'bulk-delete-user', password: 'bulk-delete-password' }),
    });
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'bulk-delete-user', password: 'bulk-delete-password' }),
    });
    const cookie = authCookieFrom(login);
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get('bulk-delete-user') as { id: string };
    const insertSession = (id: string, isArchived: number) => db.prepare(`
      INSERT INTO sessions (id, userId, title, updatedAt, isArchived)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, user.id, id, Date.now(), isArchived);
    const sessionExists = (id: string) => Boolean(db.prepare('SELECT id FROM sessions WHERE id = ?').get(id));

    insertSession('bulk-active-one', 0);
    insertSession('bulk-archive-one', 1);
    const archivesResponse = await request('/api/history/all/archived', { method: 'DELETE', cookie });
    expect(archivesResponse.status).toBe(200);
    expect(sessionExists('bulk-active-one')).toBe(true);
    expect(sessionExists('bulk-archive-one')).toBe(false);

    insertSession('bulk-archive-two', 1);
    const activeResponse = await request('/api/history/all/active', { method: 'DELETE', cookie });
    expect(activeResponse.status).toBe(200);
    expect(sessionExists('bulk-active-one')).toBe(false);
    expect(sessionExists('bulk-archive-two')).toBe(true);

    insertSession('bulk-active-two', 0);
    const allResponse = await request('/api/history/all/all', { method: 'DELETE', cookie });
    expect(allResponse.status).toBe(200);
    expect(sessionExists('bulk-active-two')).toBe(false);
    expect(sessionExists('bulk-archive-two')).toBe(false);

    const invalidResponse = await request('/api/history/all/unknown', { method: 'DELETE', cookie });
    expect(invalidResponse.status).toBe(400);
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
