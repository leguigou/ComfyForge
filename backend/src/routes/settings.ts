import express from 'express';
import db from '../services/database';
import { authenticate } from '../middleware/auth';

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  const user = (req as any).user;
  const userSettings = db.prepare('SELECT data FROM user_settings WHERE userId = ?').get(user.id) as any;
  if (userSettings) return res.json(JSON.parse(userSettings.data));

  const globalSettings = db.prepare('SELECT data FROM settings WHERE id = 1').get() as any;
  res.json(globalSettings ? JSON.parse(globalSettings.data) : {});
});

router.post('/', authenticate, (req, res) => {
  const user = (req as any).user;
  db.prepare(`
    INSERT INTO user_settings (userId, data, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(userId) DO UPDATE SET
      data = excluded.data,
      updatedAt = excluded.updatedAt
  `).run(user.id, JSON.stringify(req.body), Date.now());
  res.json({ success: true });
});

export default router;
