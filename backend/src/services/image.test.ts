import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureThumbnail,
  generateThumbnail,
  generateThumbnailVariants,
  getThumbnailFilename,
  parseThumbnailFilename,
} from './image';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  )));
});

describe('responsive thumbnails', () => {
  it('uses stable filenames for every supported size', () => {
    expect(getThumbnailFilename('photo', 160)).toBe('photo_thumb-160.webp');
    expect(getThumbnailFilename('photo', 256)).toBe('photo_thumb-256.webp');
    expect(getThumbnailFilename('photo', 400)).toBe('photo_thumb.webp');
    expect(parseThumbnailFilename('photo_thumb-160.webp')).toEqual({
      baseName: 'photo',
      originalName: 'photo.webp',
      size: 160,
    });
    expect(parseThumbnailFilename('not-a-thumbnail.webp')).toBeNull();
  });

  it('generates WebP variants with bounded dimensions', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comfyforge-thumbs-'));
    temporaryDirectories.push(directory);
    const source = await sharp({
      create: { width: 900, height: 600, channels: 3, background: '#7c3aed' },
    }).png().toBuffer();

    await generateThumbnailVariants(source, directory, 'photo');

    for (const size of [160, 256, 400] as const) {
      const outputPath = path.join(directory, getThumbnailFilename('photo', size));
      const metadata = await sharp(await fs.promises.readFile(outputPath)).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBeLessThanOrEqual(size);
      expect(metadata.height).toBeLessThanOrEqual(size);
    }
  });

  it('deduplicates simultaneous generation of a missing variant', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comfyforge-thumbs-'));
    temporaryDirectories.push(directory);
    const sourcePath = path.join(directory, 'source.webp');
    const destinationPath = path.join(directory, 'photo_thumb-160.webp');
    const source = await sharp({
      create: { width: 500, height: 500, channels: 3, background: '#111827' },
    }).webp().toBuffer();
    await fs.promises.writeFile(sourcePath, source);

    const first = ensureThumbnail(sourcePath, destinationPath, 160, directory);
    const second = ensureThumbnail(sourcePath, destinationPath, 160, directory);
    expect(second).toBe(first);
    await Promise.all([first, second]);
    await expect(fs.promises.access(destinationPath)).resolves.toBeUndefined();
  });

  it('rejects thumbnail writes outside the allowed output directory', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'comfyforge-thumbs-'));
    temporaryDirectories.push(directory);
    const allowedDirectory = path.join(directory, 'allowed');
    const escapedPath = path.join(directory, 'escaped.webp');
    const source = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#dc2626' },
    }).webp().toBuffer();

    await expect(generateThumbnail(source, escapedPath, 160, allowedDirectory))
      .rejects.toThrow('outside the allowed directory');
    await expect(fs.promises.access(escapedPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
