import fs from 'fs';
import http from 'http';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const authSecret = 'statistics-test-secret-with-more-than-32-characters';
const runtimeDir = path.join(process.cwd(), '.test-runtime', `statistics-${process.pid}`);
const databasePath = path.join(runtimeDir, 'history.db');
const imagesDir = path.join(runtimeDir, 'images');

let server: http.Server;
let baseUrl: string;
let authCookie: string;
let db: typeof import('../services/database').default;

const cookieFrom = (response: Response) => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  return values
    .map(value => value.split(';')[0])
    .reverse()
    .find(value => value.startsWith('userId=') && value !== 'userId=') || '';
};

beforeAll(async () => {
  fs.mkdirSync(runtimeDir, { recursive: true });
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = databasePath;
  process.env.IMAGES_DIR = imagesDir;
  process.env.APP_PASSWORD = 'statistics-test-password';

  const [{ createApp }, databaseModule] = await Promise.all([
    import('../app'),
    import('../services/database'),
  ]);
  db = databaseModule.default;
  server = http.createServer(createApp(authSecret));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'statistics-test-password' }),
  });
  expect(loginResponse.status).toBe(200);
  authCookie = cookieFrom(loginResponse);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  fs.rmSync(runtimeDir, { recursive: true, force: true });
});

describe('statistics tags', () => {
  it('returns the liked prompt count for each tag', async () => {
    const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
    const now = Date.now();
    const sessionId = 'statistics-liked-prompts-session';

    db.prepare(`
      INSERT INTO sessions (id, userId, title, updatedAt)
      VALUES (?, ?, 'Statistics test', ?)
    `).run(sessionId, user.id, now);
    db.prepare(`
      INSERT INTO messages (id, sessionId, role, text, prompt, timestamp, status, isPromptFavorite)
      VALUES ('statistics-liked-message', ?, 'bot', '', 'A liked portrait', ?, 'completed', 1)
    `).run(sessionId, now);
    db.prepare(`
      INSERT INTO tags (id, category, labelFr, labelEn)
      VALUES ('statistics-portrait', 'content', 'Portrait test', 'Test portrait')
      ON CONFLICT(id) DO NOTHING
    `).run();
    db.prepare(`
      INSERT INTO message_tags (messageId, tagId)
      VALUES ('statistics-liked-message', 'statistics-portrait')
    `).run();

    const params = new URLSearchParams({
      start: String(now - 60_000),
      end: String(now + 60_000),
      granularity: 'day',
      timezoneOffset: '0',
    });
    const response = await fetch(`${baseUrl}/api/statistics?${params}`, {
      headers: { Cookie: authCookie },
    });
    const body = await response.json() as { tags: Array<{ slug: string; likedPrompts: number }> };

    expect(response.status).toBe(200);
    expect(body.tags.find(tag => tag.slug === 'statistics-portrait')?.likedPrompts).toBe(1);
  });
});

describe('statistics storage', () => {
  it('returns only the authenticated user original images and thumbnail cache', async () => {
    const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
    const userImagesDir = path.join(imagesDir, user.id);
    const userThumbnailsDir = path.join(imagesDir, 'thumbnails', user.id);
    fs.mkdirSync(userImagesDir, { recursive: true });
    fs.mkdirSync(userThumbnailsDir, { recursive: true });
    fs.mkdirSync(path.join(imagesDir, 'imports', user.id), { recursive: true });

    fs.writeFileSync(path.join(userImagesDir, 'first.webp'), Buffer.alloc(17));
    fs.writeFileSync(path.join(userImagesDir, 'second.png'), Buffer.alloc(23));
    fs.writeFileSync(path.join(userImagesDir, 'notes.txt'), Buffer.alloc(101));
    fs.writeFileSync(path.join(imagesDir, 'imports', user.id, 'import.webp'), Buffer.alloc(53));
    fs.writeFileSync(path.join(userThumbnailsDir, 'first_thumb.webp'), Buffer.alloc(5));
    fs.writeFileSync(path.join(userThumbnailsDir, 'first_thumb-160.webp'), Buffer.alloc(3));
    fs.writeFileSync(path.join(userThumbnailsDir, 'unrelated.webp'), Buffer.alloc(29));

    const unauthorized = await fetch(`${baseUrl}/api/statistics/storage`);
    expect(unauthorized.status).toBe(401);

    const response = await fetch(`${baseUrl}/api/statistics/storage`, {
      headers: { Cookie: authCookie },
    });
    const body = await response.json() as {
      images: { fileCount: number; totalBytes: number };
      thumbnails: { fileCount: number; totalBytes: number };
      totalBytes: number;
      calculatedAt: number;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.images).toEqual({ fileCount: 2, totalBytes: 40 });
    expect(body.thumbnails).toEqual({ fileCount: 2, totalBytes: 8 });
    expect(body.totalBytes).toBe(48);
    expect(body.calculatedAt).toBeGreaterThan(0);
  });
});
