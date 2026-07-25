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
