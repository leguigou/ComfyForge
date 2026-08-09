import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// libvips' file cache can keep recently-read thumbnails locked on Windows,
// preventing deletion or replacement. Keep the in-memory caches while closing
// file handles as soon as each pipeline completes.
if (process.platform === 'win32') sharp.cache({ files: 0 });

// Project root is the parent of the backend directory if running from backend, 
// or the current directory if running from the root.
const backendDir = process.cwd().endsWith('backend') ? process.cwd() : path.join(process.cwd(), 'backend');
const rootDir = path.resolve(backendDir, '..');

export const imagesDir = process.env.IMAGES_DIR
  ? path.resolve(process.env.IMAGES_DIR)
  : path.join(rootDir, 'images');
export const thumbnailsDir = path.join(imagesDir, 'thumbnails');
export const importsDir = path.join(imagesDir, 'imports');

export const THUMBNAIL_VARIANTS = [
  { size: 160, quality: 60 },
  { size: 256, quality: 65 },
  { size: 400, quality: 70 },
] as const;
export type ThumbnailSize = (typeof THUMBNAIL_VARIANTS)[number]['size'];

const thumbnailVariantBySize = new Map<number, (typeof THUMBNAIL_VARIANTS)[number]>(
  THUMBNAIL_VARIANTS.map(variant => [variant.size, variant])
);
const pendingThumbnailJobs = new Map<string, Promise<sharp.OutputInfo>>();
export type ThumbnailCacheStats = { fileCount: number; totalBytes: number };
export type UserImageStorageStats = {
  images: ThumbnailCacheStats;
  thumbnails: ThumbnailCacheStats;
  totalBytes: number;
  calculatedAt: number;
};
const activeThumbnailPurges = new Map<string, Promise<ThumbnailCacheStats>>();
const pendingStorageStats = new Map<string, Promise<UserImageStorageStats>>();
const storageStatsCache = new Map<string, { expiresAt: number; value: UserImageStorageStats }>();
const storageStatsRevisions = new Map<string, number>();
const STORAGE_STATS_TTL_MS = 30_000;
const ORIGINAL_IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.avif']);

console.log(`[ImageService] Images directory: ${imagesDir}`);
console.log(`[ImageService] Thumbnails directory: ${thumbnailsDir}`);

if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
if (!fs.existsSync(thumbnailsDir)) fs.mkdirSync(thumbnailsDir, { recursive: true });
if (!fs.existsSync(importsDir)) fs.mkdirSync(importsDir, { recursive: true });

export const getThumbnailFilename = (baseName: string, size: ThumbnailSize) => (
  `${baseName}_thumb${size === 400 ? '' : `-${size}`}.webp`
);

export const parseThumbnailFilename = (filename: string) => {
  const match = /^(.*)_thumb(?:-(160|256|400))?\.webp$/i.exec(path.basename(filename));
  if (!match?.[1]) return null;
  const size = Number(match[2] || 400);
  if (!thumbnailVariantBySize.has(size)) return null;
  return { baseName: match[1], originalName: `${match[1]}.webp`, size: size as ThumbnailSize };
};

export const generateThumbnail = async (
  originalPath: string | Buffer,
  thumbPath: string,
  size: ThumbnailSize = 400,
) => {
  const dir = path.dirname(thumbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const variant = thumbnailVariantBySize.get(size) || thumbnailVariantBySize.get(400)!;

  const { data, info } = await sharp(originalPath)
    .rotate()
    .resize(variant.size, variant.size, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: variant.quality, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
  await fs.promises.writeFile(thumbPath, data);
  invalidateStorageStatsForPath(thumbPath, thumbnailsDir);
  return info;
};

export const ensureThumbnail = (
  originalPath: string,
  thumbPath: string,
  size: ThumbnailSize,
) => {
  const existing = pendingThumbnailJobs.get(thumbPath);
  if (existing) return existing;
  const resolvedThumbPath = path.resolve(thumbPath);
  const activePurge = [...activeThumbnailPurges.entries()].find(([directory]) => (
    resolvedThumbPath.startsWith(directory + path.sep)
  ))?.[1];
  const job = (activePurge
    ? activePurge.then(() => generateThumbnail(originalPath, thumbPath, size))
    : generateThumbnail(originalPath, thumbPath, size))
    .finally(() => pendingThumbnailJobs.delete(thumbPath));
  pendingThumbnailJobs.set(thumbPath, job);
  return job;
};

const getUserThumbnailDirectory = (userId: string) => {
  if (!userId || path.basename(userId) !== userId) throw new Error('Invalid user thumbnail directory');
  const directory = path.resolve(thumbnailsDir, userId);
  const resolvedRoot = path.resolve(thumbnailsDir);
  if (!directory.startsWith(resolvedRoot + path.sep)) throw new Error('Invalid user thumbnail directory');
  return directory;
};

const getUserImageDirectory = (userId: string) => {
  if (!userId || path.basename(userId) !== userId) throw new Error('Invalid user image directory');
  const directory = path.resolve(imagesDir, userId);
  const resolvedRoot = path.resolve(imagesDir);
  if (!directory.startsWith(resolvedRoot + path.sep)) throw new Error('Invalid user image directory');
  return directory;
};

const invalidateUserImageStorageStats = (userId: string) => {
  storageStatsCache.delete(userId);
  storageStatsRevisions.set(userId, (storageStatsRevisions.get(userId) || 0) + 1);
};

const invalidateStorageStatsForPath = (filePath: string, root: string) => {
  const relativePath = path.relative(path.resolve(root), path.resolve(filePath));
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return;
  const userId = relativePath.split(path.sep)[0];
  if (userId) invalidateUserImageStorageStats(userId);
};

const listThumbnailCacheFiles = async (directory: string) => {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const filenames = entries
    .filter(entry => entry.isFile() && Boolean(parseThumbnailFilename(entry.name)))
    .map(entry => entry.name);
  const files: Array<{ path: string; bytes: number }> = [];
  for (let offset = 0; offset < filenames.length; offset += 100) {
    const chunk = filenames.slice(offset, offset + 100);
    const details = await Promise.all(chunk.map(async filename => {
      const filePath = path.join(directory, filename);
      try {
        const stat = await fs.promises.stat(filePath);
        return stat.isFile() ? { path: filePath, bytes: stat.size } : null;
      } catch (error: any) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    }));
    files.push(...details.filter((file): file is { path: string; bytes: number } => Boolean(file)));
  }
  return files;
};

const listOriginalImageFiles = async (directory: string) => {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const filenames = entries
    .filter(entry => entry.isFile()
      && ORIGINAL_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      && !parseThumbnailFilename(entry.name))
    .map(entry => entry.name);
  const files: Array<{ path: string; bytes: number }> = [];
  for (let offset = 0; offset < filenames.length; offset += 100) {
    const chunk = filenames.slice(offset, offset + 100);
    const details = await Promise.all(chunk.map(async filename => {
      const filePath = path.join(directory, filename);
      try {
        const stat = await fs.promises.stat(filePath);
        return stat.isFile() ? { path: filePath, bytes: stat.size } : null;
      } catch (error: any) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    }));
    files.push(...details.filter((file): file is { path: string; bytes: number } => Boolean(file)));
  }
  return files;
};

export const getThumbnailCacheStats = async (userId: string): Promise<ThumbnailCacheStats> => {
  const directory = getUserThumbnailDirectory(userId);
  const activePurge = activeThumbnailPurges.get(directory);
  if (activePurge) await activePurge;
  const files = await listThumbnailCacheFiles(directory);
  return {
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
  };
};

export const getUserImageStorageStats = (userId: string): Promise<UserImageStorageStats> => {
  // Validate the user scope before consulting either cache.
  const imageDirectory = getUserImageDirectory(userId);
  const cached = storageStatsCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);

  const pending = pendingStorageStats.get(userId);
  if (pending) return pending;

  const revision = storageStatsRevisions.get(userId) || 0;
  let operation!: Promise<UserImageStorageStats>;
  operation = Promise.all([
    listOriginalImageFiles(imageDirectory),
    getThumbnailCacheStats(userId),
  ]).then(([imageFiles, thumbnails]) => {
    const images = {
      fileCount: imageFiles.length,
      totalBytes: imageFiles.reduce((total, file) => total + file.bytes, 0),
    };
    const value = {
      images,
      thumbnails,
      totalBytes: images.totalBytes + thumbnails.totalBytes,
      calculatedAt: Date.now(),
    };
    if ((storageStatsRevisions.get(userId) || 0) === revision) {
      storageStatsCache.set(userId, { expiresAt: Date.now() + STORAGE_STATS_TTL_MS, value });
    }
    return value;
  }).finally(() => {
    if (pendingStorageStats.get(userId) === operation) pendingStorageStats.delete(userId);
  });
  pendingStorageStats.set(userId, operation);
  return operation;
};

export const purgeThumbnailCache = (userId: string): Promise<ThumbnailCacheStats> => {
  const directory = getUserThumbnailDirectory(userId);
  const existing = activeThumbnailPurges.get(directory);
  if (existing) return existing;

  invalidateUserImageStorageStats(userId);

  let operation!: Promise<ThumbnailCacheStats>;
  operation = (async () => {
    const pending = [...pendingThumbnailJobs.entries()]
      .filter(([filePath]) => path.resolve(filePath).startsWith(directory + path.sep))
      .map(([, job]) => job);
    await Promise.allSettled(pending);
    await new Promise<void>(resolve => setImmediate(resolve));

    const files = await listThumbnailCacheFiles(directory);
    const deleted: Array<{ path: string; bytes: number }> = [];
    for (let offset = 0; offset < files.length; offset += 100) {
      const chunk = files.slice(offset, offset + 100);
      const results = await Promise.all(chunk.map(async file => {
        try {
          await fs.promises.rm(file.path, { force: true, maxRetries: 5, retryDelay: 50 });
          return file;
        } catch (error: any) {
          if (error?.code === 'ENOENT') return null;
          throw error;
        }
      }));
      deleted.push(...results.filter((file): file is { path: string; bytes: number } => Boolean(file)));
    }
    return {
      fileCount: deleted.length,
      totalBytes: deleted.reduce((total, file) => total + file.bytes, 0),
    };
  })().finally(() => {
    invalidateUserImageStorageStats(userId);
    if (activeThumbnailPurges.get(directory) === operation) activeThumbnailPurges.delete(directory);
  });
  activeThumbnailPurges.set(directory, operation);
  return operation;
};

export const generateThumbnailVariants = async (
  original: string | Buffer,
  outputDir: string,
  baseName: string,
) => {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const source = sharp(original).rotate();
  const results = await Promise.all(THUMBNAIL_VARIANTS.map(async variant => {
    const { data, info } = await source.clone()
      .resize(variant.size, variant.size, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: variant.quality, effort: 4, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });
    await fs.promises.writeFile(
      path.join(outputDir, getThumbnailFilename(baseName, variant.size)),
      data,
    );
    return info;
  }));
  invalidateStorageStatsForPath(outputDir, thumbnailsDir);
  return results;
};

export const deleteFiles = (files: { imageUrl?: string; thumbnailUrl?: string }[]) => {
  const resolvedImagesDir = path.resolve(imagesDir);

  files.forEach(file => {
    try {
      if (file.imageUrl && file.imageUrl.startsWith('/api/image-files/')) {
        const relativePath = decodeURIComponent(file.imageUrl.replace('/api/image-files/', '').split('?')[0]);
        const imgPath = path.resolve(imagesDir, relativePath);
        if (!imgPath.startsWith(resolvedImagesDir + path.sep)) return;
        if (fs.existsSync(imgPath)) {
          fs.unlinkSync(imgPath);
          invalidateStorageStatsForPath(imgPath, imagesDir);
        }
      }
      if (file.thumbnailUrl && file.thumbnailUrl.startsWith('/api/image-files/')) {
        const relativePath = decodeURIComponent(file.thumbnailUrl.replace('/api/image-files/', '').split('?')[0]);
        const thumbPath = path.resolve(imagesDir, relativePath);
        if (!thumbPath.startsWith(resolvedImagesDir + path.sep)) return;
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
        const parsedThumbnail = parseThumbnailFilename(path.basename(thumbPath));
        if (parsedThumbnail) {
          for (const variant of THUMBNAIL_VARIANTS) {
            const variantPath = path.join(
              path.dirname(thumbPath),
              getThumbnailFilename(parsedThumbnail.baseName, variant.size),
            );
            if (variantPath !== thumbPath && fs.existsSync(variantPath)) fs.unlinkSync(variantPath);
          }
        }
        invalidateStorageStatsForPath(thumbPath, thumbnailsDir);
      }
    } catch (err) {
      console.error(`Failed to delete files:`, err);
    }
  });
};
