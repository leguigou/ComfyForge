import fs from 'fs';
import http from 'http';
import path from 'path';
import sharp from 'sharp';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const authSecret = 'gallery-download-test-secret-over-32-characters';
const runtimeDir = path.join(process.cwd(), '.test-runtime', `gallery-download-${process.pid}`);

let server: http.Server;
let baseUrl: string;
let authCookie: string;
let csrfToken: string;
let db: typeof import('../services/database').default;
let sourceImage: Buffer;
let sourcePath: string;

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
  process.env.APP_PASSWORD = 'gallery-download-password';

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
    body: JSON.stringify({ username: 'admin', password: 'gallery-download-password' }),
  });
  expect(login.status).toBe(200);
  const cookies = responseCookies(login);
  authCookie = [
    [...cookies].reverse().find(cookie => cookie.startsWith('csrfToken=')),
    [...cookies].reverse().find(cookie => cookie.startsWith('userId=')),
  ].filter(Boolean).join('; ');
  csrfToken = login.headers.get('x-csrf-token') || '';

  const user = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
  const sessionId = 'download-session';
  db.prepare(`
    INSERT INTO sessions (id, userId, title, updatedAt)
    VALUES (?, ?, 'Downloads', ?)
  `).run(sessionId, user.id, Date.now());

  const userImagesDir = path.join(process.env.IMAGES_DIR!, user.id);
  fs.mkdirSync(userImagesDir, { recursive: true });
  sourcePath = path.join(userImagesDir, 'download-source.webp');
  sourceImage = await sharp({
    create: { width: 41, height: 31, channels: 3, background: '#275a8d' },
  }).webp({ quality: 85 }).toBuffer();
  fs.writeFileSync(sourcePath, sourceImage);

  db.prepare(`
    INSERT INTO messages (
      id, sessionId, role, text, prompt, generationPrompt, imageUrl, timestamp,
      model, width, height, steps, cfg, status, seed, sampler, scheduler, generationParams
    ) VALUES (?, ?, 'bot', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)
  `).run(
    'download-message',
    sessionId,
    'original prompt',
    'portrait café',
    `/api/image-files/${user.id}/download-source.webp`,
    Date.now(),
    'realistic-model.safetensors',
    41,
    31,
    12,
    4.5,
    9988,
    'euler',
    'normal',
    JSON.stringify({ negativePrompt: 'blurry' }),
  );
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  fs.rmSync(runtimeDir, { recursive: true, force: true });
});

describe('gallery image downloads', () => {
  it('adds Civitai metadata only when enabled and never changes the stored image', async () => {
    const plainResponse = await request('/api/gallery/download/download-message');
    const plainDownload = Buffer.from(await plainResponse.arrayBuffer());
    expect(plainResponse.status).toBe(200);
    expect(plainResponse.headers.get('content-disposition')).toContain('img-download-message.webp');
    expect(plainDownload.equals(sourceImage)).toBe(true);

    const enable = await request('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ civitaiMetadataOnDownload: true }),
    });
    expect(enable.status).toBe(200);

    const taggedResponse = await request('/api/gallery/download/download-message');
    const taggedDownload = Buffer.from(await taggedResponse.arrayBuffer());
    const taggedMetadata = await sharp(taggedDownload).metadata();
    expect(taggedResponse.status).toBe(200);
    expect(taggedDownload.equals(sourceImage)).toBe(false);
    expect(taggedMetadata.exif?.includes(Buffer.from('UNICODE\0', 'ascii'))).toBe(true);
    expect(fs.readFileSync(sourcePath).equals(sourceImage)).toBe(true);
  });
});
