import fs from 'fs';
import path from 'path';
import {
  generateThumbnail,
  getThumbnailFilename,
  thumbnailsDir,
  type ThumbnailSize,
} from '../src/services/image';

const TARGET_SIZES: ThumbnailSize[] = [160, 256];
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.THUMBNAIL_BACKFILL_CONCURRENCY) || 4));

type ThumbnailJob = {
  sourcePath: string;
  destinationPath: string;
  size: ThumbnailSize;
};

const collectCanonicalThumbnails = async (directory: string): Promise<string[]> => {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectCanonicalThumbnails(entryPath);
    return /_thumb\.webp$/i.test(entry.name) ? [entryPath] : [];
  }));
  return nested.flat();
};

const run = async () => {
  const canonicalThumbnails = await collectCanonicalThumbnails(thumbnailsDir);
  const jobs: ThumbnailJob[] = [];

  for (const sourcePath of canonicalThumbnails) {
    const baseName = path.basename(sourcePath, '_thumb.webp');
    for (const size of TARGET_SIZES) {
      const destinationPath = path.join(path.dirname(sourcePath), getThumbnailFilename(baseName, size));
      try {
        await fs.promises.access(destinationPath, fs.constants.F_OK);
      } catch {
        jobs.push({ sourcePath, destinationPath, size });
      }
    }
  }

  if (jobs.length === 0) {
    console.log(`[Thumbnails] ${canonicalThumbnails.length} images checked; all responsive variants already exist.`);
    return;
  }

  console.log(`[Thumbnails] Generating ${jobs.length} responsive variants with ${CONCURRENCY} workers...`);
  let nextJob = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (true) {
      const jobIndex = nextJob++;
      const job = jobs[jobIndex];
      if (!job) return;
      await generateThumbnail(job.sourcePath, job.destinationPath, job.size);
      completed += 1;
      if (completed % 250 === 0 || completed === jobs.length) {
        console.log(`[Thumbnails] ${completed}/${jobs.length}`);
      }
    }
  });

  await Promise.all(workers);
  console.log(`[Thumbnails] Done. ${canonicalThumbnails.length} source thumbnails checked.`);
};

run().catch(error => {
  console.error('[Thumbnails] Backfill failed:', error);
  process.exitCode = 1;
});
