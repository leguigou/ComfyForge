import fs from 'fs';
import http from 'http';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const axiosPost = vi.hoisted(() => vi.fn().mockResolvedValue({ data: {} }));
vi.mock('axios', () => ({
  default: {
    post: axiosPost,
    get: vi.fn(),
  },
}));

const authSecret = 'generation-cancel-secret-with-more-than-32-characters';
const runtimeDir = path.join(process.cwd(), '.test-runtime', `generation-cancel-${process.pid}`);

let server: http.Server;
let baseUrl: string;
let authCookie: string;
let csrfToken: string;
let db: typeof import('../services/database').default;
let sessionId: string;
let userId: string;

const responseCookies = (response: Response) => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  return values.flatMap(value => value.match(/(?:userId|csrfToken)=[^;,\s]+/g) || []);
};

const request = (pathname: string, body: Record<string, unknown>) => fetch(`${baseUrl}${pathname}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': authCookie,
    'X-CSRF-Token': csrfToken,
  },
  body: JSON.stringify(body),
});

const patchRequest = (pathname: string, body: Record<string, unknown>) => fetch(`${baseUrl}${pathname}`, {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': authCookie,
    'X-CSRF-Token': csrfToken,
  },
  body: JSON.stringify(body),
});

const deleteRequest = (pathname: string) => fetch(`${baseUrl}${pathname}`, {
  method: 'DELETE',
  headers: {
    'Cookie': authCookie,
    'X-CSRF-Token': csrfToken,
  },
});

const insertGeneration = (messageId: string, status: 'pending' | 'processing', createdAt: number) => {
  db.prepare(`
    INSERT INTO messages (id, sessionId, role, text, prompt, timestamp, status)
    VALUES (?, ?, 'bot', '', ?, ?, ?)
  `).run(messageId, sessionId, `${messageId} prompt`, createdAt, status);
  db.prepare(`
    INSERT INTO queue (messageId, userId, prompt, originalPrompt, sessionId, params, status, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    messageId,
    userId,
    `${messageId} prompt`,
    `${messageId} prompt`,
    sessionId,
    JSON.stringify({ comfyUrl: 'http://127.0.0.1:8188' }),
    status,
    createdAt,
  );
};

beforeAll(async () => {
  fs.mkdirSync(runtimeDir, { recursive: true });
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = path.join(runtimeDir, 'history.db');
  process.env.APP_PASSWORD = 'generation-cancel-password';
  process.env.ALLOW_PRIVATE_SERVICE_URLS = 'true';

  const [{ createApp }, databaseModule] = await Promise.all([
    import('../app'),
    import('../services/database'),
  ]);
  db = databaseModule.default;
  server = http.createServer(createApp(authSecret));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'generation-cancel-password' }),
  });
  const cookies = responseCookies(login);
  authCookie = [
    [...cookies].reverse().find(cookie => cookie.startsWith('csrfToken=')),
    [...cookies].reverse().find(cookie => cookie.startsWith('userId=')),
  ].filter(Boolean).join('; ');
  csrfToken = login.headers.get('x-csrf-token') || '';

  const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
  userId = user.id;
  sessionId = 'generation-cancellation-session';
  db.prepare(`
    INSERT INTO sessions (id, userId, title, updatedAt)
    VALUES (?, ?, 'Generation cancellation', ?)
  `).run(sessionId, userId, Date.now());
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  fs.rmSync(runtimeDir, { recursive: true, force: true });
});

describe('targeted generation cancellation', () => {
  it('disconnects one pending generation without interrupting ComfyUI or the rest of the queue', async () => {
    insertGeneration('pending-cancelled', 'pending', 1);
    insertGeneration('pending-kept', 'pending', 2);

    const response = await request('/api/generate/interrupt', { messageId: 'pending-cancelled' });
    const body = await response.json() as { success: boolean; interrupted: boolean };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, interrupted: false });
    expect(db.prepare('SELECT id FROM queue WHERE messageId = ?').get('pending-cancelled')).toBeUndefined();
    expect(db.prepare('SELECT id FROM queue WHERE messageId = ?').get('pending-kept')).toBeTruthy();
    expect(db.prepare('SELECT status FROM messages WHERE id = ?').get('pending-cancelled')).toEqual({ status: 'failed' });
    expect(db.prepare('SELECT status FROM messages WHERE id = ?').get('pending-kept')).toEqual({ status: 'pending' });
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('interrupts ComfyUI only for the selected generation that is already processing', async () => {
    axiosPost.mockClear();
    insertGeneration('processing-cancelled', 'processing', 3);

    const response = await request('/api/generate/interrupt', { messageId: 'processing-cancelled' });
    const body = await response.json() as { success: boolean; interrupted: boolean };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, interrupted: true });
    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(axiosPost).toHaveBeenCalledWith('http://127.0.0.1:8188/interrupt');
    expect(db.prepare('SELECT id FROM queue WHERE messageId = ?').get('pending-kept')).toBeTruthy();
  });

  it('replaces the prompt of a running generation and queues it again', async () => {
    axiosPost.mockClear();
    insertGeneration('processing-edited', 'processing', 4);
    const oldQueue = db.prepare('SELECT id FROM queue WHERE messageId = ?')
      .get('processing-edited') as { id: number };

    const response = await patchRequest('/api/generate/pending/processing-edited/prompt', {
      prompt: 'replacement prompt',
    });
    const body = await response.json() as { success: boolean; status: string; generationPrompt: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, status: 'pending', generationPrompt: 'replacement prompt' });
    expect(axiosPost).toHaveBeenCalledWith(
      'http://127.0.0.1:8188/interrupt',
      undefined,
      { timeout: 10_000 },
    );
    expect(db.prepare('SELECT id, prompt, status FROM queue WHERE messageId = ?').get('processing-edited'))
      .toMatchObject({ prompt: 'replacement prompt', status: 'pending' });
    expect((db.prepare('SELECT id FROM queue WHERE messageId = ?').get('processing-edited') as { id: number }).id)
      .not.toBe(oldQueue.id);
    expect(db.prepare('SELECT prompt, generationPrompt, status, generationStartedAt FROM messages WHERE id = ?')
      .get('processing-edited'))
      .toEqual({
        prompt: 'replacement prompt',
        generationPrompt: 'replacement prompt',
        status: 'pending',
        generationStartedAt: null,
      });
  });

  it('deletes the user prompt when its cancelled generation is deleted', async () => {
    db.prepare(`
      INSERT INTO messages (id, sessionId, role, text, prompt, timestamp, status)
      VALUES ('paired-user-first', ?, 'user', 'paired prompt first', '', 10, 'completed')
    `).run(sessionId);
    db.prepare(`
      INSERT INTO messages (id, sessionId, role, text, prompt, timestamp, status)
      VALUES ('paired-bot-first', ?, 'bot', 'Interrompu par l''utilisateur', 'paired prompt first', 11, 'failed')
    `).run(sessionId);

    const response = await deleteRequest(`/api/history/${sessionId}/message/paired-bot-first`);
    const body = await response.json() as { deletedMessageIds: string[] };

    expect(response.status).toBe(200);
    expect(body.deletedMessageIds).toEqual(['paired-bot-first', 'paired-user-first']);
    expect(db.prepare("SELECT id FROM messages WHERE id IN ('paired-user-first', 'paired-bot-first')").all()).toHaveLength(0);
  });

  it('deletes the linked generation when its user prompt is deleted', async () => {
    db.prepare(`
      INSERT INTO messages (id, sessionId, role, text, prompt, timestamp, status)
      VALUES ('paired-user-second', ?, 'user', 'paired prompt second', '', 12, 'completed')
    `).run(sessionId);
    db.prepare(`
      INSERT INTO messages (id, sessionId, role, text, prompt, timestamp, status)
      VALUES ('paired-bot-second', ?, 'bot', 'Interrompu par l''utilisateur', 'paired prompt second', 13, 'failed')
    `).run(sessionId);

    const response = await deleteRequest(`/api/history/${sessionId}/message/paired-user-second`);
    const body = await response.json() as { deletedMessageIds: string[] };

    expect(response.status).toBe(200);
    expect(body.deletedMessageIds).toEqual(['paired-user-second', 'paired-bot-second']);
    expect(db.prepare("SELECT id FROM messages WHERE id IN ('paired-user-second', 'paired-bot-second')").all()).toHaveLength(0);
  });
});
