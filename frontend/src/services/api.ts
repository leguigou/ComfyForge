export const getApiBase = () => {
  // 1. Priority: Environment variable
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;

  // For all standard deployments and local dev, we now rely on path-based routing (/api)
  // This means the API is accessed on the EXACT same host and port as the frontend.
  // This completely eliminates CORS and Cross-Origin HTTP Cookie blocking issues.
  // In dev mode: Vite Proxy handles /api -> 127.0.0.1:3001
  // In prod mode: Nginx/Traefik handles /api -> backend:3001
  return '';
};

export const API_BASE = getApiBase();

export const formatDuration = (seconds: number | undefined) => {
  if (seconds === undefined || seconds === null) return '';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s.toString().padStart(2, '0')}s`;
};

export const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const getFullImageUrl = (url: string) => {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${API_BASE}${url}`;
};

export type ThumbnailSize = 160 | 256 | 400;

const RESPONSIVE_THUMBNAIL_PATTERN = /^(\/api\/image-files\/thumbnails\/.*)_thumb(?:-(?:160|256|400))?\.webp([?#].*)?$/i;

export const getThumbnailVariantUrl = (url: string, size: ThumbnailSize) => {
  const match = RESPONSIVE_THUMBNAIL_PATTERN.exec(url);
  if (!match) return getFullImageUrl(url);
  const suffix = size === 400 ? '' : `-${size}`;
  return getFullImageUrl(`${match[1]}_thumb${suffix}.webp${match[2] || ''}`);
};

export const getThumbnailSrcSet = (url: string) => {
  if (!RESPONSIVE_THUMBNAIL_PATTERN.test(url)) return undefined;
  return ([160, 256, 400] as const)
    .map(size => `${getThumbnailVariantUrl(url, size)} ${size}w`)
    .join(', ');
};

export const getAvatarThumbnailUrl = (url: string | null | undefined) => {
  if (!url || url.startsWith('http')) return url || '';

  const path = url.split(/[?#]/, 1)[0];
  const prefix = '/api/image-files/';
  if (!path.startsWith(prefix)) return url;

  const segments = path.slice(prefix.length).split('/').filter(Boolean);
  if (
    segments.length === 0
    || segments.length > 2
    || segments[0] === 'thumbnails'
    || segments[0] === 'imports'
  ) {
    return url;
  }

  const filename = segments.at(-1)!;
  if (!filename.endsWith('.webp') || filename.endsWith('_thumb.webp')) return url;

  const thumbnailFilename = `${filename.slice(0, -'.webp'.length)}_thumb.webp`;
  return segments.length === 2
    ? `${prefix}thumbnails/${segments[0]}/${thumbnailFilename}`
    : `${prefix}thumbnails/${thumbnailFilename}`;
};
