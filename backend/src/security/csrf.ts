import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { RequestHandler } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_COOKIE = 'csrfToken';
const CSRF_HEADER = 'X-CSRF-Token';

const signToken = (nonce: string, secret: string) => {
  const signature = createHmac('sha256', secret).update(nonce).digest('base64url');
  return `${nonce}.${signature}`;
};

const createToken = (secret: string) => signToken(randomBytes(32).toString('base64url'), secret);

const tokensMatch = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const isValidToken = (token: string, secret: string) => {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;
  const nonce = token.slice(0, separator);
  return tokensMatch(token, signToken(nonce, secret));
};

const isLoginRequest = (path: string) => path === '/api/auth/login' || path === '/auth/login';

export const createCsrfProtection = (authSecret: string): RequestHandler => (req, res, next) => {
  const authenticated = Boolean(req.signedCookies?.userId || req.cookies?.userId);
  const cookieToken = typeof req.cookies?.csrfToken === 'string' ? req.cookies.csrfToken : '';
  const validCookieToken = cookieToken && isValidToken(cookieToken, authSecret) ? cookieToken : '';
  const shouldIssueToken = authenticated
    || req.path === '/api/auth/check'
    || req.path === '/auth/check'
    || isLoginRequest(req.path);
  const csrfToken = validCookieToken || (shouldIssueToken ? createToken(authSecret) : '');

  if (csrfToken) {
    if (csrfToken !== cookieToken) {
      const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
      res.cookie(CSRF_COOKIE, csrfToken, {
        httpOnly: true,
        path: '/',
        sameSite: isHttps ? 'none' : 'lax',
        secure: isHttps,
      });
    }
    res.setHeader(CSRF_HEADER, csrfToken);
  }

  if (SAFE_METHODS.has(req.method) || !authenticated || isLoginRequest(req.path)) {
    return next();
  }

  const headerToken = req.get(CSRF_HEADER) || '';
  if (!csrfToken || !headerToken || !tokensMatch(cookieToken, headerToken)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  return next();
};
