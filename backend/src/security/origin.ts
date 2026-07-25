import { Request } from 'express';

const normalizeOrigin = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const configuredOrigins = () => new Set(
  (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(value => normalizeOrigin(value.trim()))
    .filter((value): value is string => Boolean(value))
);

export const isAllowedOrigin = (
  origin: string | undefined,
  host: string | undefined,
  protocol: string
) => {
  if (!origin) return true;

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin || !host) return false;

  const requestOrigin = normalizeOrigin(`${protocol}://${host}`);
  if (requestOrigin === normalizedOrigin) return true;

  if (configuredOrigins().has(normalizedOrigin)) return true;

  if (process.env.NODE_ENV !== 'production') {
    const parsed = new URL(normalizedOrigin);
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (isLocalhost && ['5173', '4173'].includes(parsed.port)) return true;
  }

  return false;
};

export const isAllowedRequestOrigin = (req: Request) => {
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.headers.host;
  return isAllowedOrigin(req.headers.origin, host, req.protocol);
};
