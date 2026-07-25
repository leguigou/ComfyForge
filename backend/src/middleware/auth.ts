import { Request, Response, NextFunction } from 'express';
import db from '../services/database';
import { User } from '../types';

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const userId = req.signedCookies.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = db.prepare('SELECT id, username, isAdmin, avatarUrl FROM users WHERE id = ?').get(userId) as Pick<User, 'id' | 'username' | 'isAdmin' | 'avatarUrl'> | undefined;
  if (!user) {
    res.clearCookie('userId');
    return res.status(401).json({ error: 'Unauthorized' });
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
