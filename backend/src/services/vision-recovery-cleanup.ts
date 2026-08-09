import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';

export const VISION_RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type VisionRecoveryImport = {
  id: string;
  userId: string;
  importUrl: string | null;
};

type CleanupOptions = {
  now?: number;
  retentionMs?: number;
};

const resolveImportPath = (rootDir: string, userId: string, importUrl: string | null) => {
  if (!importUrl) return null;

  const prefix = `/api/image-files/imports/${encodeURIComponent(userId)}/`;
  if (!importUrl.startsWith(prefix)) return null;

  try {
    const encodedFilename = importUrl.slice(prefix.length).split(/[?#]/, 1)[0];
    const filename = decodeURIComponent(encodedFilename);
    if (!filename || path.basename(filename) !== filename) return null;

    const userDir = path.resolve(rootDir, userId);
    const candidate = path.resolve(userDir, filename);
    if (!candidate.startsWith(userDir + path.sep)) return null;
    return candidate;
  } catch {
    return null;
  }
};

const comparablePath = (filePath: string) => (
  process.platform === 'win32' ? filePath.toLocaleLowerCase() : filePath
);

const unlinkIfPresent = async (filePath: string): Promise<'removed' | 'missing' | 'failed'> => {
  try {
    await fs.promises.unlink(filePath);
    return 'removed';
  } catch (error: any) {
    if (error?.code === 'ENOENT') return 'missing';
    console.warn(`[VisionCleanup] Unable to remove ${filePath}: ${error?.message || error}`);
    return 'failed';
  }
};

export const cleanupExpiredVisionRecoveries = async (
  database: Database.Database,
  rootDir: string,
  options: CleanupOptions = {},
) => {
  const now = options.now ?? Date.now();
  const cutoff = now - (options.retentionMs ?? VISION_RECOVERY_RETENTION_MS);
  const expired = database.prepare(`
    SELECT id, userId, importUrl
    FROM vision_prompt_recoveries
    WHERE updatedAt < ?
  `).all(cutoff) as VisionRecoveryImport[];

  const removableIds: string[] = [];
  let removedFiles = 0;

  for (const recovery of expired) {
    const filePath = resolveImportPath(rootDir, recovery.userId, recovery.importUrl);
    const unlinkResult = filePath ? await unlinkIfPresent(filePath) : 'missing';
    if (unlinkResult !== 'failed') {
      if (unlinkResult === 'removed') removedFiles++;
      removableIds.push(recovery.id);
    }
  }

  const deleteRecovery = database.prepare(`
    DELETE FROM vision_prompt_recoveries
    WHERE id = ? AND updatedAt < ?
  `);
  const removedRecoveries = database.transaction((ids: string[]) => ids.reduce(
    (total, id) => total + deleteRecovery.run(id, cutoff).changes,
    0,
  ))(removableIds);

  const retained = database.prepare(`
    SELECT id, userId, importUrl
    FROM vision_prompt_recoveries
    WHERE importUrl IS NOT NULL
  `).all() as VisionRecoveryImport[];
  const retainedPaths = new Set(retained
    .map(recovery => resolveImportPath(rootDir, recovery.userId, recovery.importUrl))
    .filter((filePath): filePath is string => Boolean(filePath))
    .map(filePath => comparablePath(path.resolve(filePath))));

  let removedOrphans = 0;
  const userDirectories = await fs.promises.readdir(rootDir, { withFileTypes: true }).catch((error: any) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });

  for (const userDirectory of userDirectories) {
    if (!userDirectory.isDirectory() || userDirectory.isSymbolicLink()) continue;
    const userDir = path.join(rootDir, userDirectory.name);
    const entries = await fs.promises.readdir(userDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const filePath = path.resolve(userDir, entry.name);
      if (retainedPaths.has(comparablePath(filePath))) continue;
      const stat = await fs.promises.stat(filePath);
      if (stat.mtimeMs >= cutoff) continue;
      if (await unlinkIfPresent(filePath) === 'removed') removedOrphans++;
    }
  }

  return { removedRecoveries, removedFiles, removedOrphans };
};
