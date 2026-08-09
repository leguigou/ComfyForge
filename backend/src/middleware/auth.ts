import { Request, Response, NextFunction } from 'express';
import db from '../services/database';
import { User } from '../types';

const IMAGE_AUTH_CACHE_TTL_MS = 10_000;
type AuthenticatedUser = Pick<User, 'id' | 'username' | 'isAdmin' | 'avatarUrl'>;
const imageAuthCache = new Map<string, { user: AuthenticatedUser; expiresAt: number }>();

const readAuthenticatedUser = (userId: string) => db.prepare(
  'SELECT id, username, isAdmin, avatarUrl FROM users WHERE id = ?'
).get(userId) as AuthenticatedUser | undefined;

export const invalidateImageAuthCache = (userId?: string) => {
  if (userId) imageAuthCache.delete(userId);
  else imageAuthCache.clear();
};

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const userId = req.signedCookies.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = readAuthenticatedUser(userId);
  if (!user) {
    res.clearCookie('userId');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.user = user;
  next();
};

// Image grids can issue dozens of parallel GETs. Revalidating the same signed
// session once per file needlessly serializes SQLite work, so image requests
// share a short-lived user lookup. Account changes explicitly invalidate it.
export const authenticateImageFile = (req: Request, res: Response, next: NextFunction) => {
  const userId = req.signedCookies.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const now = Date.now();
  const cached = imageAuthCache.get(userId);
  const user = cached && cached.expiresAt > now ? cached.user : readAuthenticatedUser(userId);
  if (!user) {
    imageAuthCache.delete(userId);
    res.clearCookie('userId');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!cached || cached.user !== user) {
    imageAuthCache.set(userId, { user, expiresAt: now + IMAGE_AUTH_CACHE_TTL_MS });
  }

  req.user = user;
  next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  authenticate(req, res, () => {
    if (req.user?.isAdmin) {
      return next();
    }
    res.status(403).json({ error: 'Forbidden: Admin access required' });
  });
};
