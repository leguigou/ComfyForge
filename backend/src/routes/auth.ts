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

const appLockRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many unlock attempts. Please try again later.' },
});

type AppLockMethod = 'pin' | 'pattern';

interface AppLockRow {
  enabled: number;
  method: AppLockMethod;
  credentialHash: string;
  pinHash: string | null;
  pinLength: number;
  patternHash: string | null;
  timeoutMinutes: number;
}

const APP_LOCK_TIMEOUTS = new Set([1, 5, 15, 30, 60, 120, 240, 480, 1440]);

const normalizeAppLockCredential = (method: AppLockMethod, value: unknown) => {
  if (typeof value !== 'string') return null;
  if (method === 'pin') return /^\d{3,6}$/.test(value) ? value : null;
  if (!/^\d(?:-\d){3,8}$/.test(value)) return null;
  const nodes = value.split('-').map(Number);
  return nodes.every(node => node >= 0 && node <= 8) && new Set(nodes).size === nodes.length
    ? nodes.join('-')
    : null;
};

const getCredentialHashes = (row?: AppLockRow) => ({
  pinHash: row?.pinHash || (row?.method === 'pin' ? row.credentialHash : '') || '',
  patternHash: row?.patternHash || (row?.method === 'pattern' ? row.credentialHash : '') || '',
});

const serializeAppLock = (row?: AppLockRow) => {
  const hashes = getCredentialHashes(row);
  const method = row?.method === 'pattern' ? 'pattern' as const : 'pin' as const;
  const storedPinLength = row?.pinLength;
  return {
    enabled: row?.enabled === 1,
    method,
    timeoutMinutes: row?.timeoutMinutes || 15,
    hasCredential: Boolean(method === 'pin' ? hashes.pinHash : hashes.patternHash),
    hasPin: Boolean(hashes.pinHash),
    pinLength: storedPinLength !== undefined && storedPinLength >= 3 && storedPinLength <= 6 ? storedPinLength : 4,
    hasPattern: Boolean(hashes.patternHash),
  };
};

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

router.get('/app-lock', authenticate, (req: Request, res: Response) => {
  const row = db.prepare(`
    SELECT enabled, method, credentialHash, pinHash, pinLength, patternHash, timeoutMinutes
    FROM user_app_locks WHERE userId = ?
  `).get(req.user!.id) as AppLockRow | undefined;
  return res.json(serializeAppLock(row));
});

router.put('/app-lock', authenticate, (req: Request, res: Response) => {
  const enabled = req.body?.enabled === true;
  const method: AppLockMethod | null = req.body?.method === 'pin' || req.body?.method === 'pattern'
    ? req.body.method
    : null;
  const timeoutMinutes = Number(req.body?.timeoutMinutes);
  if (!method || !APP_LOCK_TIMEOUTS.has(timeoutMinutes)) {
    return res.status(400).json({ error: 'Invalid app lock configuration' });
  }

  const existing = db.prepare(`
    SELECT enabled, method, credentialHash, pinHash, pinLength, patternHash, timeoutMinutes
    FROM user_app_locks WHERE userId = ?
  `).get(req.user!.id) as AppLockRow | undefined;
  const suppliedCredential = req.body?.credential === undefined
    ? null
    : normalizeAppLockCredential(method, req.body.credential);
  if (req.body?.credential !== undefined && !suppliedCredential) {
    return res.status(400).json({ error: method === 'pin' ? 'PIN must contain 3 to 6 digits' : 'Pattern must contain 4 to 9 unique points' });
  }
  const existingHashes = getCredentialHashes(existing);
  const selectedExistingHash = method === 'pin' ? existingHashes.pinHash : existingHashes.patternHash;
  if (enabled && !selectedExistingHash && !suppliedCredential) {
    return res.status(400).json({ error: 'A new unlock credential is required' });
  }

  const suppliedHash = suppliedCredential ? bcrypt.hashSync(suppliedCredential, 10) : '';
  const pinHash = method === 'pin' && suppliedHash ? suppliedHash : existingHashes.pinHash;
  const pinLength = method === 'pin' && suppliedCredential ? suppliedCredential.length : existing?.pinLength || 4;
  const patternHash = method === 'pattern' && suppliedHash ? suppliedHash : existingHashes.patternHash;
  const credentialHash = method === 'pin' ? pinHash : patternHash;
  db.prepare(`
    INSERT INTO user_app_locks (userId, enabled, method, credentialHash, pinHash, pinLength, patternHash, timeoutMinutes, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(userId) DO UPDATE SET
      enabled = excluded.enabled,
      method = excluded.method,
      credentialHash = excluded.credentialHash,
      pinHash = excluded.pinHash,
      pinLength = excluded.pinLength,
      patternHash = excluded.patternHash,
      timeoutMinutes = excluded.timeoutMinutes,
      updatedAt = excluded.updatedAt
  `).run(req.user!.id, enabled ? 1 : 0, method, credentialHash, pinHash || null, pinLength, patternHash || null, timeoutMinutes, Date.now());

  return res.json({ success: true, ...serializeAppLock({ enabled: enabled ? 1 : 0, method, credentialHash, pinHash, pinLength, patternHash, timeoutMinutes }) });
});

router.post('/app-lock/verify', appLockRateLimiter, authenticate, (req: Request, res: Response) => {
  const row = db.prepare(`
    SELECT enabled, method, credentialHash, pinHash, pinLength, patternHash, timeoutMinutes
    FROM user_app_locks WHERE userId = ?
  `).get(req.user!.id) as AppLockRow | undefined;
  if (!row || row.enabled !== 1) return res.status(400).json({ error: 'App lock is not enabled' });
  const method: AppLockMethod = req.body?.method === 'pin' || req.body?.method === 'pattern'
    ? req.body.method
    : row.method;
  const hashes = getCredentialHashes(row);
  const credentialHash = method === 'pin' ? hashes.pinHash : hashes.patternHash;
  const credential = normalizeAppLockCredential(method, req.body?.credential);
  if (!credentialHash || !credential || !bcrypt.compareSync(credential, credentialHash)) {
    return res.status(401).json({ error: 'Invalid unlock credential' });
  }
  return res.json({ success: true, method });
});

export default router;
