import { User } from './types';

// Extend Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: Pick<User, 'id' | 'username' | 'isAdmin' | 'avatarUrl'>;
    }
  }
}

export {};
