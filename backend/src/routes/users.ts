import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import db from '../services/database';
import { requireAdmin, authenticate } from '../middleware/auth';
import { imagesDir } from '../services/image';
import { deleteCompanionAssetsForUser } from '../services/companion-assets';
import { getQueueLimits, getUserQueueCapacity } from '../services/queue';

const router = express.Router();
const MAX_CONFIGURABLE_QUEUE_LIMIT = 10_000;

const parseQueueLimit = (value: unknown): number | null | undefined => {
  if (value === null) return null;
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= MAX_CONFIGURABLE_QUEUE_LIMIT
    ? value
    : undefined;
};

router.patch('/me', authenticate, (req, res) => {
  const { username, password, avatarUrl } = req.body;
  const user = (req as any).user;
  
  try {
    if (username) {
      const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim().toLowerCase(), user.id);
      if (existing) return res.status(400).json({ error: 'Username already exists' });
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username.trim().toLowerCase(), user.id);
    }
    
    if (password) {
      const passwordHash = bcrypt.hashSync(password.trim(), 10);
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(passwordHash, user.id);
    }
    
    if (avatarUrl !== undefined) {
      db.prepare('UPDATE users SET avatarUrl = ? WHERE id = ?').run(avatarUrl, user.id);
    }
    
    const updatedUser = db.prepare('SELECT id, username, isAdmin, avatarUrl FROM users WHERE id = ?').get(user.id) as any;
    res.json({ success: true, user: { username: updatedUser.username, isAdmin: updatedUser.isAdmin === 1, avatarUrl: updatedUser.avatarUrl } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.isAdmin, u.avatarUrl, u.queueLimit, u.createdAt,
      (
        SELECT COUNT(*) FROM queue q
        WHERE q.userId = u.id AND q.status IN ('pending', 'processing')
      ) AS activeQueueCount
    FROM users u
    ORDER BY u.createdAt DESC
  `).all() as any[];
  
  const usersWithStats = users.map(user => {
    const userImages = db.prepare(`
      SELECT m.imageUrl, m.thumbnailUrl 
      FROM messages m 
      JOIN sessions s ON m.sessionId = s.id 
      WHERE s.userId = ? AND m.imageUrl IS NOT NULL
    `).all(user.id) as any[];

    let totalBytes = 0;
    const imageCount = userImages.length;

    userImages.forEach(img => {
      try {
        if (img.imageUrl && img.imageUrl.startsWith('/api/image-files/')) {
          const relativePath = decodeURIComponent(img.imageUrl.replace('/api/image-files/', '').split('?')[0]);
          const imgPath = path.join(imagesDir, relativePath);
          if (fs.existsSync(imgPath)) totalBytes += fs.statSync(imgPath).size;
        }
        if (img.thumbnailUrl && img.thumbnailUrl.startsWith('/api/image-files/')) {
          const relativePath = decodeURIComponent(img.thumbnailUrl.replace('/api/image-files/', '').split('?')[0]);
          const thumbPath = path.join(imagesDir, relativePath);
          if (fs.existsSync(thumbPath)) totalBytes += fs.statSync(thumbPath).size;
        }
      } catch (err) {}
    });

    return {
      ...user,
      imageCount,
      diskUsage: totalBytes
    };
  });

  res.json(usersWithStats);
});

router.post('/', requireAdmin, (req, res) => {
  const { username, password, isAdmin } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const queueLimit = req.body.queueLimit === undefined
    ? getQueueLimits().perUser
    : parseQueueLimit(req.body.queueLimit);
  if (queueLimit === undefined) {
    return res.status(400).json({
      code: 'INVALID_QUEUE_LIMIT',
      error: `Queue limit must be null or an integer between 1 and ${MAX_CONFIGURABLE_QUEUE_LIMIT}`
    });
  }
  
  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password.trim(), 10);
  
  try {
    db.prepare('INSERT INTO users (id, username, password, isAdmin, queueLimit, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, username.trim().toLowerCase(), passwordHash, isAdmin ? 1 : 0, queueLimit, Date.now());
    res.json({ success: true, id, queueLimit });
  } catch (err: any) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

router.delete('/:id', requireAdmin, (req, res) => {
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (userId === (req as any).user.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  deleteCompanionAssetsForUser(userId);
  res.json({ success: true });
});

router.patch('/:id/password', requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'New password required' });
  const passwordHash = bcrypt.hashSync(password.trim(), 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(passwordHash, req.params.id);
  res.json({ success: true });
});

router.patch('/:id', requireAdmin, (req, res) => {
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const current = db.prepare(`
    SELECT id, username, password, isAdmin, avatarUrl, queueLimit, createdAt
    FROM users
    WHERE id = ?
  `).get(userId) as {
    id: string;
    username: string;
    password: string;
    isAdmin: number;
    avatarUrl: string | null;
    queueLimit: number | null;
    createdAt: number;
  } | undefined;

  if (!current) return res.status(404).json({ error: 'User not found' });

  const username = req.body?.username === undefined
    ? current.username
    : typeof req.body.username === 'string'
      ? req.body.username.trim().toLowerCase()
      : '';
  if (!username || username.length > 100) {
    return res.status(400).json({ error: 'Username must contain between 1 and 100 characters' });
  }

  const password = req.body?.password;
  if (password !== undefined && (typeof password !== 'string' || !password.trim() || password.length > 200)) {
    return res.status(400).json({ error: 'Password must contain between 1 and 200 characters' });
  }

  const isAdmin = req.body?.isAdmin === undefined ? current.isAdmin === 1 : req.body.isAdmin;
  if (typeof isAdmin !== 'boolean') {
    return res.status(400).json({ error: 'Administrator status must be a boolean' });
  }
  if (userId === (req as any).user.id && !isAdmin) {
    return res.status(400).json({ error: 'Cannot remove your own administrator access' });
  }

  const queueLimit = req.body?.queueLimit === undefined
    ? current.queueLimit
    : parseQueueLimit(req.body.queueLimit);
  if (queueLimit === undefined) {
    return res.status(400).json({
      code: 'INVALID_QUEUE_LIMIT',
      error: `Queue limit must be null or an integer between 1 and ${MAX_CONFIGURABLE_QUEUE_LIMIT}`
    });
  }

  const avatarUrl = req.body?.avatarUrl === undefined
    ? current.avatarUrl
    : req.body.avatarUrl === null || req.body.avatarUrl === ''
      ? null
      : typeof req.body.avatarUrl === 'string' && req.body.avatarUrl.length <= 4096
        ? req.body.avatarUrl
        : undefined;
  if (avatarUrl === undefined) {
    return res.status(400).json({ error: 'Avatar URL is invalid' });
  }

  const duplicate = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId);
  if (duplicate) return res.status(400).json({ error: 'Username already exists' });

  const passwordHash = password === undefined ? current.password : bcrypt.hashSync(password.trim(), 10);

  try {
    db.prepare(`
      UPDATE users
      SET username = ?, password = ?, isAdmin = ?, avatarUrl = ?, queueLimit = ?
      WHERE id = ?
    `).run(username, passwordHash, isAdmin ? 1 : 0, avatarUrl, queueLimit, userId);

    res.json({
      success: true,
      user: {
        id: current.id,
        username,
        isAdmin,
        avatarUrl,
        queueLimit,
        createdAt: current.createdAt
      },
      capacity: getUserQueueCapacity(userId)
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Unable to update user' });
  }
});

router.patch('/:id/queue-limit', requireAdmin, (req, res) => {
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const queueLimit = parseQueueLimit(req.body?.queueLimit);
  if (queueLimit === undefined) {
    return res.status(400).json({
      code: 'INVALID_QUEUE_LIMIT',
      error: `Queue limit must be null or an integer between 1 and ${MAX_CONFIGURABLE_QUEUE_LIMIT}`
    });
  }

  const result = db.prepare('UPDATE users SET queueLimit = ? WHERE id = ?').run(queueLimit, userId);
  if (result.changes !== 1) return res.status(404).json({ error: 'User not found' });

  res.json({ success: true, queueLimit, capacity: getUserQueueCapacity(userId) });
});

export default router;
