import fs from 'fs';
import http from 'http';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const authSecret = 'gallery-test-secret-with-more-than-32-characters';
const runtimeDir = path.join(process.cwd(), '.test-runtime', `gallery-${process.pid}`);

let server: http.Server;
let baseUrl: string;
let authCookie: string;
let csrfToken: string;
let db: typeof import('../services/database').default;
let rebuildPromptGroupCacheForUser: typeof import('../services/prompt-group-cache').rebuildPromptGroupCacheForUser;
let refreshPromptGroupCacheForMessage: typeof import('../services/prompt-group-cache').refreshPromptGroupCacheForMessage;

const responseCookies = (response: Response) => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  return values.flatMap(value => value.match(/(?:userId|csrfToken)=[^;,\s]+/g) || []);
};

const request = (pathname: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers);
  headers.set('Cookie', authCookie);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (csrfToken && !['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  return fetch(`${baseUrl}${pathname}`, { ...options, headers });
};

beforeAll(async () => {
  fs.mkdirSync(runtimeDir, { recursive: true });
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = path.join(runtimeDir, 'history.db');
  process.env.IMAGES_DIR = path.join(runtimeDir, 'images');
  process.env.APP_PASSWORD = 'gallery-test-password';

  const [{ createApp }, databaseModule, promptGroupCacheModule] = await Promise.all([
    import('../app'),
    import('../services/database'),
    import('../services/prompt-group-cache'),
  ]);
  db = databaseModule.default;
  rebuildPromptGroupCacheForUser = promptGroupCacheModule.rebuildPromptGroupCacheForUser;
  refreshPromptGroupCacheForMessage = promptGroupCacheModule.refreshPromptGroupCacheForMessage;
  server = http.createServer(createApp(authSecret));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'gallery-test-password' }),
  });
  expect(login.status).toBe(200);
  const cookies = responseCookies(login);
  authCookie = [
    [...cookies].reverse().find(cookie => cookie.startsWith('csrfToken=')),
    [...cookies].reverse().find(cookie => cookie.startsWith('userId=')),
  ].filter(Boolean).join('; ');
  csrfToken = login.headers.get('x-csrf-token') || '';
  expect(authCookie).toContain('userId=s%3A');
  expect(authCookie).toContain('csrfToken=');
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  fs.rmSync(runtimeDir, { recursive: true, force: true });
});

describe('manual gallery groups', () => {
  it('groups different prompts only in grouped view and can dissolve the manual group', async () => {
    const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
    const sessionId = 'manual-gallery-session';
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, userId, title, updatedAt)
      VALUES (?, ?, 'Manual gallery groups', ?)
    `).run(sessionId, user.id, now);
    const insert = db.prepare(`
      INSERT INTO messages (id, sessionId, role, prompt, generationPrompt, imageUrl, timestamp)
      VALUES (?, ?, 'bot', ?, ?, ?, ?)
    `);
    insert.run('manual-a', sessionId, 'portrait prompt', 'portrait prompt', '/a.webp', now + 3);
    insert.run('manual-b', sessionId, 'landscape prompt', 'landscape prompt', '/b.webp', now + 2);
    insert.run('manual-c', sessionId, 'portrait prompt', 'portrait prompt', '/c.webp', now + 1);
    rebuildPromptGroupCacheForUser(user.id);
    const untouchedCacheBefore = db.prepare(`
      SELECT updatedAt FROM prompt_group_cache WHERE messageId = 'manual-c'
    `).get() as { updatedAt: number };

    const create = await request('/api/gallery/manual-groups', {
      method: 'POST',
      body: JSON.stringify({ messageIds: ['manual-a', 'manual-b'] }),
    });
    const created = await create.json() as { manualGroupId: string };
    expect(create.status, JSON.stringify(created)).toBe(201);
    expect(created.manualGroupId).toBeTruthy();
    expect(db.prepare(`
      SELECT updatedAt FROM prompt_group_cache WHERE messageId = 'manual-c'
    `).get()).toEqual(untouchedCacheBefore);

    const normal = await request('/api/gallery?groupByPrompt=false&includeTotal=true');
    const normalBody = await normal.json() as { items: Array<{ messageId: string; groupCount?: number }> };
    expect(normalBody.items).toHaveLength(3);
    expect(normalBody.items.every(item => item.groupCount === undefined)).toBe(true);

    const grouped = await request('/api/gallery?groupByPrompt=true&includeTotal=true');
    const groupedBody = await grouped.json() as {
      total: number;
      items: Array<{ messageId: string; groupCount: number; manualGroupId?: string }>;
    };
    expect(groupedBody.total).toBe(2);
    expect(groupedBody.items.find(item => item.manualGroupId === created.manualGroupId)?.groupCount).toBe(2);

    const rebuild = await request('/api/gallery/prompt-group-cache/rebuild', { method: 'POST' });
    const rebuildStarted = await rebuild.json() as { status: string; totalPhotos: number; manualGroupsPreserved: number };
    expect(rebuild.status).toBe(202);
    expect(rebuildStarted).toMatchObject({ status: 'running', totalPhotos: 3, manualGroupsPreserved: 1 });
    let rebuildStatus: { status: string; processedPhotos: number; totalPhotos: number; groupsFormed: number; manualGroupsPreserved: number } | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const statusResponse = await request('/api/gallery/prompt-group-cache/status');
      rebuildStatus = await statusResponse.json() as typeof rebuildStatus;
      if (rebuildStatus?.status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(rebuildStatus).toMatchObject({
      status: 'complete',
      processedPhotos: 3,
      totalPhotos: 3,
      groupsFormed: 2,
      manualGroupsPreserved: 1,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE manualGroupId = ?').get(created.manualGroupId))
      .toEqual({ count: 2 });

    const group = await request('/api/gallery/group/manual-a');
    const groupBody = await group.json() as { items: Array<{ messageId: string; generationPrompt: string }> };
    expect(groupBody.items.map(item => item.generationPrompt)).toEqual(['portrait prompt', 'landscape prompt']);

    const cover = await request('/api/gallery/group/manual-b/cover', { method: 'PUT' });
    expect(cover.status).toBe(200);
    const coveredGroup = await request('/api/gallery/group/manual-b');
    const coveredBody = await coveredGroup.json() as { items: Array<{ messageId: string; isGroupCover: number }> };
    expect(coveredBody.items[0]).toMatchObject({ messageId: 'manual-b', isGroupCover: 1 });

    const dissolve = await request('/api/gallery/group/manual-b/manual', { method: 'DELETE' });
    expect(dissolve.status).toBe(200);
    const automaticUngroupAttempt = await request('/api/gallery/group/manual-a/manual', { method: 'DELETE' });
    expect(automaticUngroupAttempt.status).toBe(409);

    const regrouped = await request('/api/gallery?groupByPrompt=true&includeTotal=true');
    const regroupedBody = await regrouped.json() as {
      total: number;
      items: Array<{ groupCount: number; manualGroupId?: string | null }>;
    };
    expect(regroupedBody.total).toBe(2);
    expect(regroupedBody.items.some(item => item.groupCount === 2 && !item.manualGroupId)).toBe(true);
  });
});

describe('session-scoped gallery', () => {
  it('normalizes punctuation and applies configurable fuzzy prompt grouping', async () => {
    const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
    const sessionId = 'fuzzy-prompt-gallery';
    const now = Date.now();
    db.prepare(`INSERT INTO sessions (id, userId, title, updatedAt) VALUES (?, ?, 'Fuzzy prompts', ?)`)
      .run(sessionId, user.id, now);
    const insert = db.prepare(`
      INSERT INTO messages (id, sessionId, role, generationPrompt, imageUrl, timestamp)
      VALUES (?, ?, 'bot', ?, ?, ?)
    `);
    const base = 'one two three four five six seven eight nine ten';
    insert.run('fuzzy-a', sessionId, `${base},`, '/fuzzy-a.webp', now + 1);
    insert.run('fuzzy-b', sessionId, '  one two three four five six seven eight nine ten... ', '/fuzzy-b.webp', now + 2);
    insert.run('fuzzy-c', sessionId, 'one two three four five six seven eight nine portrait', '/fuzzy-c.webp', now + 3);

    db.prepare(`
      INSERT INTO user_settings (userId, data, updatedAt) VALUES (?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
    `).run(user.id, JSON.stringify({
      galleryPromptSimilarityMinWords: 11,
      galleryPromptSimilarityThreshold: 90,
    }), Date.now());
    rebuildPromptGroupCacheForUser(user.id);
    const exact = await request(`/api/gallery?sessionId=${sessionId}&groupByPrompt=true&includeTotal=true`);
    const exactBody = await exact.json() as { total: number; items: Array<{ messageId: string; groupCount: number }> };
    expect(exactBody.total).toBe(2);
    expect(exactBody.items.find(entry => entry.groupCount === 2)).toBeTruthy();

    db.prepare('UPDATE user_settings SET data = ?, updatedAt = ? WHERE userId = ?').run(JSON.stringify({
      galleryPromptSimilarityMinWords: 10,
      galleryPromptSimilarityThreshold: 90,
    }), Date.now(), user.id);
    rebuildPromptGroupCacheForUser(user.id);
    const fuzzy = await request(`/api/gallery?sessionId=${sessionId}&groupByPrompt=true&includeTotal=true`);
    const fuzzyBody = await fuzzy.json() as { total: number; items: Array<{ messageId: string; groupCount: number }> };
    expect(fuzzyBody.total).toBe(1);
    expect(fuzzyBody.items[0].groupCount).toBe(3);

    const opened = await request(`/api/gallery/group/${fuzzyBody.items[0].messageId}?sessionId=${sessionId}`);
    const openedBody = await opened.json() as { total: number };
    expect(openedBody.total).toBe(3);

    insert.run('fuzzy-d', sessionId, 'one two three four five six seven eight nine studio', '/fuzzy-d.webp', now + 4);
    refreshPromptGroupCacheForMessage('fuzzy-d');
    const incrementallyUpdated = await request(`/api/gallery?sessionId=${sessionId}&groupByPrompt=true&includeTotal=true`);
    const incrementallyUpdatedBody = await incrementallyUpdated.json() as { total: number; items: Array<{ groupCount: number }> };
    expect(incrementallyUpdatedBody.total).toBe(1);
    expect(incrementallyUpdatedBody.items[0].groupCount).toBe(4);

    db.prepare("UPDATE messages SET generationPrompt = 'entirely unrelated short prompt' WHERE id = 'fuzzy-d'").run();
    const persisted = await request(`/api/gallery?sessionId=${sessionId}&groupByPrompt=true&includeTotal=true`);
    const persistedBody = await persisted.json() as { total: number; items: Array<{ groupCount: number }> };
    expect(persistedBody.total).toBe(1);
    expect(persistedBody.items[0].groupCount).toBe(4);
  });

  it('incrementally joins a resolved random-list prompt to its dynamic group', async () => {
    const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
    const sessionId = 'dynamic-resolved-gallery';
    const now = Date.now();
    const template = 'An amateur photo of a young brunette [Origin] woman with long dark hair in a high ponytail and wispy bangs standing front';
    const resolved = template.replace('[Origin]', 'brazilian');

    try {
      db.prepare(`INSERT INTO sessions (id, userId, title, updatedAt) VALUES (?, ?, 'Dynamic resolved prompts', ?)`)
        .run(sessionId, user.id, now);
      const insert = db.prepare(`
        INSERT INTO messages (
          id, sessionId, role, prompt, generationPrompt, randomSelections,
          imageUrl, timestamp
        ) VALUES (?, ?, 'bot', ?, ?, ?, ?, ?)
      `);
      insert.run(
        'dynamic-resolved-source', sessionId, template, resolved,
        JSON.stringify([{ slug: 'Origin', value: 'brazilian' }]),
        '/dynamic-resolved-source.webp', now + 1,
      );
      refreshPromptGroupCacheForMessage('dynamic-resolved-source');
      insert.run(
        'dynamic-resolved-copy', sessionId, resolved, resolved, '[]',
        '/dynamic-resolved-copy.webp', now + 2,
      );
      refreshPromptGroupCacheForMessage('dynamic-resolved-copy');

      const response = await request(`/api/gallery?sessionId=${sessionId}&groupByPrompt=true&includeTotal=true`);
      const body = await response.json() as { total: number; items: Array<{ messageId: string; groupCount: number }> };
      expect(response.status).toBe(200);
      expect(body.total).toBe(1);
      expect(body.items[0]).toMatchObject({ messageId: 'dynamic-resolved-copy', groupCount: 2 });
    } finally {
      db.prepare('DELETE FROM messages WHERE sessionId = ?').run(sessionId);
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      rebuildPromptGroupCacheForUser(user.id);
    }
  });

  it('returns only the requested conversation and keeps prompt groups inside it', async () => {
    const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
    const firstSessionId = 'thread-gallery-first';
    const secondSessionId = 'thread-gallery-second';
    const now = Date.now();
    const insertSession = db.prepare(`
      INSERT INTO sessions (id, userId, title, updatedAt, isArchived)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertSession.run(firstSessionId, user.id, 'First thread gallery', now, 0);
    insertSession.run(secondSessionId, user.id, 'Second thread gallery', now, 1);

    const insertMessage = db.prepare(`
      INSERT INTO messages (id, sessionId, role, prompt, generationPrompt, imageUrl, timestamp)
      VALUES (?, ?, 'bot', 'shared prompt', 'shared prompt', ?, ?)
    `);
    insertMessage.run('thread-gallery-a', firstSessionId, '/thread-a.webp', now + 3);
    insertMessage.run('thread-gallery-b', firstSessionId, '/thread-b.webp', now + 2);
    insertMessage.run('thread-gallery-c', secondSessionId, '/thread-c.webp', now + 1);
    rebuildPromptGroupCacheForUser(user.id);

    const first = await request(`/api/gallery?sessionId=${firstSessionId}&groupByPrompt=true&includeTotal=true`);
    const firstBody = await first.json() as {
      total: number;
      items: Array<{ sessionId: string; messageId: string; groupCount: number }>;
    };
    expect(first.status).toBe(200);
    expect(firstBody.total).toBe(1);
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.items[0]).toMatchObject({ sessionId: firstSessionId, groupCount: 2 });

    const group = await request(`/api/gallery/group/${firstBody.items[0].messageId}?sessionId=${firstSessionId}`);
    const groupBody = await group.json() as { items: Array<{ sessionId: string }> };
    expect(groupBody.items).toHaveLength(2);
    expect(groupBody.items.every(item => item.sessionId === firstSessionId)).toBe(true);

    const mismatchedGroup = await request(`/api/gallery/group/thread-gallery-a?sessionId=${secondSessionId}`);
    expect(mismatchedGroup.status).toBe(404);

    const archived = await request(`/api/gallery?sessionId=${secondSessionId}&includeTotal=true`);
    const archivedBody = await archived.json() as { total: number; items: Array<{ sessionId: string }> };
    expect(archivedBody.total).toBe(1);
    expect(archivedBody.items[0].sessionId).toBe(secondSessionId);
  });
});

describe('gallery metadata filters', () => {
  it('lists available values and combines model, workflow, and aspect filters', async () => {
    const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
    const sessionId = 'gallery-filter-session';
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, userId, title, updatedAt)
      VALUES (?, ?, 'Gallery filters', ?)
    `).run(sessionId, user.id, now);
    const insert = db.prepare(`
      INSERT INTO messages (id, sessionId, role, imageUrl, timestamp, model, workflow, width, height)
      VALUES (?, ?, 'bot', ?, ?, ?, ?, ?, ?)
    `);
    insert.run('filter-a', sessionId, '/filter-a.webp', now + 3, 'Realism XL', 'portrait.json', 832, 1216);
    insert.run('filter-b', sessionId, '/filter-b.webp', now + 2, 'Realism XL', 'cinema.json', 1216, 832);
    insert.run('filter-c', sessionId, '/filter-c.webp', now + 1, 'Flux Dev', 'portrait.json', 1024, 1024);

    const options = await request(`/api/gallery/filters?sessionId=${sessionId}`);
    const optionsBody = await options.json() as {
      models: Array<{ value: string; count: number }>;
      workflows: Array<{ value: string; count: number }>;
      aspects: Record<string, number>;
    };
    expect(options.status).toBe(200);
    expect(optionsBody.models).toContainEqual({ value: 'Realism XL', count: 2 });
    expect(optionsBody.workflows).toContainEqual({ value: 'portrait.json', count: 2 });
    expect(optionsBody.aspects).toEqual({ square: 1, portrait: 1, landscape: 1 });

    const filtered = await request(`/api/gallery?sessionId=${sessionId}&model=${encodeURIComponent('Realism XL')}&workflow=${encodeURIComponent('portrait.json')}&aspect=portrait&includeTotal=true`);
    const filteredBody = await filtered.json() as { total: number; items: Array<{ messageId: string }> };
    expect(filtered.status).toBe(200);
    expect(filteredBody.total).toBe(1);
    expect(filteredBody.items.map(item => item.messageId)).toEqual(['filter-a']);

    const multipleAspects = await request(`/api/gallery?sessionId=${sessionId}&aspect=square&aspect=landscape&includeTotal=true`);
    const multipleAspectsBody = await multipleAspects.json() as { total: number; items: Array<{ messageId: string }> };
    expect(multipleAspectsBody.total).toBe(2);
    expect(multipleAspectsBody.items.map(item => item.messageId)).toEqual(['filter-b', 'filter-c']);
  });
});

describe('session list pagination', () => {
  it('returns a stable cursor without loading the complete sidebar history', async () => {
    const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
    const baseTimestamp = Date.now() + 10_000_000;
    const sessionIds = Array.from({ length: 4 }, (_, index) => `paged-session-${index}`);
    const insert = db.prepare(`
      INSERT INTO sessions (id, userId, title, updatedAt, isArchived)
      VALUES (?, ?, ?, ?, 0)
    `);
    sessionIds.forEach((id, index) => insert.run(id, user.id, id, baseTimestamp - index));

    try {
      const first = await request('/api/history?limit=2&includeCursor=true&includeTotal=true');
      const firstBody = await first.json() as {
        items: Array<{ id: string }>;
        hasMore: boolean;
        nextCursor: { updatedAt: number; id: string };
        total: number;
      };
      expect(first.status).toBe(200);
      expect(firstBody.items.map(session => session.id)).toEqual(sessionIds.slice(0, 2));
      expect(firstBody.hasMore).toBe(true);
      expect(firstBody.total).toBeGreaterThanOrEqual(4);

      const second = await request(
        `/api/history?limit=2&includeCursor=true&beforeUpdatedAt=${firstBody.nextCursor.updatedAt}&beforeId=${firstBody.nextCursor.id}`
      );
      const secondBody = await second.json() as { items: Array<{ id: string }> };
      expect(secondBody.items.map(session => session.id)).toEqual(sessionIds.slice(2, 4));
    } finally {
      db.prepare(`DELETE FROM sessions WHERE id IN (${sessionIds.map(() => '?').join(',')})`).run(...sessionIds);
    }
  });
});
