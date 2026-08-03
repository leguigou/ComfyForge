import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { databaseDataDir } from './database';

const MAX_COMPANION_FILE_BYTES = 5_000_000;
const MAX_USER_COMPANION_BYTES = 100_000_000;
const SUPPORTED_TYPES = {
  'image/png': 'png',
  'image/webp': 'webp'
} as const;

type SupportedMime = keyof typeof SUPPORTED_TYPES;
type StoredAsset = { path: string; mimeType: SupportedMime; bytes: number };

export const companionAssetsDir = process.env.COMPANION_ASSETS_DIR
  ? path.resolve(process.env.COMPANION_ASSETS_DIR)
  : path.join(databaseDataDir, 'companions');

export class CompanionAssetError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'CompanionAssetError';
    this.statusCode = statusCode;
  }
}

const safeCompanionId = (value: unknown) => {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) {
    throw new CompanionAssetError('Invalid companion id');
  }
  return id;
};

const userDirectory = (userId: string) => path.join(
  companionAssetsDir,
  createHash('sha256').update(userId).digest('hex')
);

const assetStem = (companionId: string) => createHash('sha256').update(companionId).digest('hex');

const assetPath = (userId: string, companionId: string, mimeType: SupportedMime) => path.join(
  userDirectory(userId),
  `${assetStem(companionId)}.${SUPPORTED_TYPES[mimeType]}`
);

const hasValidSignature = (mimeType: SupportedMime, buffer: Buffer) => {
  if (mimeType === 'image/png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
};

const decodeDataUrl = (dataUrl: unknown) => {
  if (typeof dataUrl !== 'string') throw new CompanionAssetError('Missing companion sprite');
  const match = dataUrl.match(/^data:(image\/(?:png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new CompanionAssetError('Unsupported companion image');
  const mimeType = match[1] as SupportedMime;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_COMPANION_FILE_BYTES) {
    throw new CompanionAssetError('Companion image must be smaller than 5 MB', 413);
  }
  if (!hasValidSignature(mimeType, buffer)) throw new CompanionAssetError('Invalid companion image data');
  return { mimeType, buffer };
};

export const findCompanionAsset = (userId: string, rawCompanionId: unknown): StoredAsset | null => {
  const companionId = safeCompanionId(rawCompanionId);
  for (const mimeType of Object.keys(SUPPORTED_TYPES) as SupportedMime[]) {
    const candidate = assetPath(userId, companionId, mimeType);
    if (fs.existsSync(candidate)) {
      return { path: candidate, mimeType, bytes: fs.statSync(candidate).size };
    }
  }
  return null;
};

export const storeCompanionAsset = (userId: string, rawCompanionId: unknown, dataUrl: unknown): StoredAsset => {
  const companionId = safeCompanionId(rawCompanionId);
  const { mimeType, buffer } = decodeDataUrl(dataUrl);
  const directory = userDirectory(userId);
  fs.mkdirSync(directory, { recursive: true });

  const previous = findCompanionAsset(userId, companionId);
  const currentBytes = fs.readdirSync(directory).reduce((sum, filename) => {
    const candidate = path.join(directory, filename);
    return sum + (fs.statSync(candidate).isFile() ? fs.statSync(candidate).size : 0);
  }, 0);
  if (currentBytes - (previous?.bytes || 0) + buffer.length > MAX_USER_COMPANION_BYTES) {
    throw new CompanionAssetError('Companion storage limit reached', 413);
  }

  const target = assetPath(userId, companionId, mimeType);
  if (!fs.existsSync(target) || !fs.readFileSync(target).equals(buffer)) {
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, buffer, { flag: 'wx' });
    fs.renameSync(temporary, target);
  }
  for (const otherMime of Object.keys(SUPPORTED_TYPES) as SupportedMime[]) {
    const other = assetPath(userId, companionId, otherMime);
    if (other !== target && fs.existsSync(other)) fs.unlinkSync(other);
  }
  return { path: target, mimeType, bytes: buffer.length };
};

const publicProfile = (profile: Record<string, unknown>, asset: StoredAsset) => {
  const sanitized = { ...profile };
  delete sanitized.spriteDataUrl;
  return {
    ...sanitized,
    spriteUrl: `/api/companions/${encodeURIComponent(String(profile.id))}`,
    spriteMimeType: asset.mimeType,
    spriteBytes: asset.bytes
  };
};

export const externalizeCompanionAssets = (userId: string, rawSettings: unknown) => {
  const settings = rawSettings && typeof rawSettings === 'object'
    ? { ...(rawSettings as Record<string, unknown>) }
    : {};
  const rawCompanionSettings = settings.companionSettings;
  if (!rawCompanionSettings || typeof rawCompanionSettings !== 'object') {
    return { settings, shouldCleanup: false, retainedPaths: new Set<string>() };
  }
  const companionSettings = { ...(rawCompanionSettings as Record<string, unknown>) };
  if (!Array.isArray(companionSettings.companions)) {
    return { settings, shouldCleanup: false, retainedPaths: new Set<string>() };
  }

  const retainedPaths = new Set<string>();
  companionSettings.companions = companionSettings.companions.map(rawProfile => {
    if (!rawProfile || typeof rawProfile !== 'object') return rawProfile;
    const profile = rawProfile as Record<string, unknown>;
    if (profile.source !== 'custom') return profile;
    const companionId = safeCompanionId(profile.id);
    const asset = typeof profile.spriteDataUrl === 'string'
      ? storeCompanionAsset(userId, companionId, profile.spriteDataUrl)
      : findCompanionAsset(userId, companionId);
    if (!asset) return profile;
    retainedPaths.add(path.resolve(asset.path));
    return publicProfile(profile, asset);
  });
  settings.companionSettings = companionSettings;
  return { settings, shouldCleanup: true, retainedPaths };
};

export const cleanupCompanionAssets = (userId: string, retainedPaths: Set<string>) => {
  const directory = userDirectory(userId);
  if (!fs.existsSync(directory)) return;
  for (const filename of fs.readdirSync(directory)) {
    const candidate = path.resolve(directory, filename);
    if (!retainedPaths.has(candidate) && fs.statSync(candidate).isFile()) fs.unlinkSync(candidate);
  }
  if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
};

export const deleteCompanionAssetsForUser = (userId: string) => {
  const directory = userDirectory(userId);
  if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
};
