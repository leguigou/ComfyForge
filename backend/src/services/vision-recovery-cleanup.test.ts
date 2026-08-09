import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupExpiredVisionRecoveries } from './vision-recovery-cleanup';

const runtimeDirectories: string[] = [];

afterEach(() => {
  runtimeDirectories.splice(0).forEach(directory => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe('vision recovery import cleanup', () => {
  it('removes expired imports and old orphans while preserving active and recent files', async () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyforge-vision-cleanup-'));
    runtimeDirectories.push(runtimeDir);
    const importsDir = path.join(runtimeDir, 'imports');
    const userId = 'user-1';
    const userDir = path.join(importsDir, userId);
    fs.mkdirSync(userDir, { recursive: true });

    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE vision_prompt_recoveries (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        importUrl TEXT,
        updatedAt INTEGER NOT NULL
      )
    `);

    const now = Date.now();
    const retentionMs = 1_000;
    const oldTime = new Date(now - retentionMs - 1_000);
    const expiredFile = path.join(userDir, 'expired.png');
    const activeFile = path.join(userDir, 'active.png');
    const oldOrphan = path.join(userDir, 'old-orphan.png');
    const recentOrphan = path.join(userDir, 'recent-orphan.png');
    [expiredFile, activeFile, oldOrphan, recentOrphan].forEach(filePath => fs.writeFileSync(filePath, 'image'));
    [expiredFile, oldOrphan].forEach(filePath => fs.utimesSync(filePath, oldTime, oldTime));

    const insert = db.prepare(`
      INSERT INTO vision_prompt_recoveries (id, userId, importUrl, updatedAt)
      VALUES (?, ?, ?, ?)
    `);
    insert.run('expired', userId, `/api/image-files/imports/${userId}/expired.png`, now - retentionMs - 1);
    insert.run('active', userId, `/api/image-files/imports/${userId}/active.png`, now);

    const result = await cleanupExpiredVisionRecoveries(db, importsDir, { now, retentionMs });

    expect(result).toEqual({ removedRecoveries: 1, removedFiles: 1, removedOrphans: 1 });
    expect(fs.existsSync(expiredFile)).toBe(false);
    expect(fs.existsSync(oldOrphan)).toBe(false);
    expect(fs.existsSync(activeFile)).toBe(true);
    expect(fs.existsSync(recentOrphan)).toBe(true);
    expect(db.prepare('SELECT id FROM vision_prompt_recoveries ORDER BY id').all()).toEqual([{ id: 'active' }]);
    db.close();
  });

  it('never follows a recovery URL outside its user import directory', async () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyforge-vision-cleanup-'));
    runtimeDirectories.push(runtimeDir);
    const importsDir = path.join(runtimeDir, 'imports');
    const userDir = path.join(importsDir, 'user-1');
    fs.mkdirSync(userDir, { recursive: true });
    const outsideFile = path.join(runtimeDir, 'outside.png');
    fs.writeFileSync(outsideFile, 'keep');

    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE vision_prompt_recoveries (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        importUrl TEXT,
        updatedAt INTEGER NOT NULL
      )
    `);
    db.prepare(`
      INSERT INTO vision_prompt_recoveries (id, userId, importUrl, updatedAt)
      VALUES (?, ?, ?, ?)
    `).run('expired', 'user-1', '/api/image-files/imports/user-1/%2E%2E%2Foutside.png', 1);

    const result = await cleanupExpiredVisionRecoveries(db, importsDir, { now: 10_000, retentionMs: 1_000 });

    expect(result.removedRecoveries).toBe(1);
    expect(fs.existsSync(outsideFile)).toBe(true);
    db.close();
  });
});
