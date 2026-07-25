import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import db from '../services/database';
import { authenticate } from '../middleware/auth';
import { CookieOptions, User } from '../types';
import net from 'net';

const router = Router();

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

const getCookieDomain = (req: Request) => {
  const rawHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
  const hostname = rawHost.split(':')[0];

  if (!hostname || hostname === 'localhost' || net.isIP(hostname)) {
    return undefined;
  }

  const parts = hostname.split('.');
  return parts.length >= 2 ? `.${parts.slice(-2).join('.')}` : undefined;
};

const getCookieOptions = (req: Request, includeMaxAge = true) => {
  const isProd = process.env.NODE_ENV === 'production';
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

  const cookieOptions: CookieOptions = {
    httpOnly: true,
    signed: true,
    path: '/',
    sameSite: 'lax',
  };

  if (includeMaxAge) {
    cookieOptions.maxAge = 30 * 24 * 60 * 60 * 1000;
  }

  if (isProd) {
    const domain = getCookieDomain(req);
    if (domain) {
      cookieOptions.domain = domain;
    }
  }

  if (isHttps) {
    cookieOptions.sameSite = 'none';
    cookieOptions.secure = true;
  } else {
    cookieOptions.sameSite = 'lax';
    cookieOptions.secure = false;
  }

  return cookieOptions;
};

const clearAuthCookies = (req: Request, res: Response) => {
  const baseOptions = getCookieOptions(req, false);
  const domain = getCookieDomain(req);
  const variants = [
    baseOptions,
    { ...baseOptions, path: '/api/auth' },
    ...(domain ? [
      { ...baseOptions, domain },
      { ...baseOptions, domain, path: '/api/auth' },
    ] : []),
  ];

  variants.forEach(options => res.clearCookie('userId', options as any));
};

router.post('/login', loginRateLimiter, (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase().trim()) as User | undefined;
  if (!user || !bcrypt.compareSync(password.trim(), user.password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  clearAuthCookies(req, res);
  res.cookie('userId', user.id, getCookieOptions(req) as any);
  return res.json({
    success: true,
    user: { username: user.username, isAdmin: user.isAdmin === 1, avatarUrl: user.avatarUrl },
  });
});

router.get('/me', authenticate, (req: Request, res: Response) => {
  const user = req.user!;
  res.json({ username: user.username, isAdmin: user.isAdmin === 1, avatarUrl: user.avatarUrl });
});

router.get('/check', (req: Request, res: Response) => {
  const userId = req.signedCookies.userId || req.cookies?.userId;
  if (!userId) {
    clearAuthCookies(req, res);
    return res.json({ authenticated: false });
  }
  const user = db.prepare('SELECT username, isAdmin, avatarUrl FROM users WHERE id = ?').get(userId) as Pick<User, 'username' | 'isAdmin' | 'avatarUrl'> | undefined;
  if (!user) {
    clearAuthCookies(req, res);
    return res.json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    user: { username: user.username, isAdmin: user.isAdmin === 1, avatarUrl: user.avatarUrl },
  });
});

router.post('/logout', (req: Request, res: Response) => {
  clearAuthCookies(req, res);
  res.json({ success: true });
});

export default router;
