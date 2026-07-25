import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import db from '../services/database';
import { requireAdmin, authenticate } from '../middleware/auth';
import { imagesDir } from '../services/image';

const router = express.Router();

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
  const users = db.prepare('SELECT id, username, isAdmin, createdAt FROM users ORDER BY createdAt DESC').all() as any[];
  
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
  
  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password.trim(), 10);
  
  try {
    db.prepare('INSERT INTO users (id, username, password, isAdmin, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(id, username.trim().toLowerCase(), passwordHash, isAdmin ? 1 : 0, Date.now());
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

router.delete('/:id', requireAdmin, (req, res) => {
  if (req.params.id === (req as any).user.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.patch('/:id/password', requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'New password required' });
  const passwordHash = bcrypt.hashSync(password.trim(), 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(passwordHash, req.params.id);
  res.json({ success: true });
});

export default router;
