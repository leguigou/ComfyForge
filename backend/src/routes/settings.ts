import express from 'express';
import db from '../services/database';
import { authenticate } from '../middleware/auth';
import {
  cleanupCompanionAssets,
  CompanionAssetError,
  externalizeCompanionAssets
} from '../services/companion-assets';

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  const user = (req as any).user;
  const userSettings = db.prepare('SELECT data FROM user_settings WHERE userId = ?').get(user.id) as any;
  if (userSettings) {
    try {
      const parsed = JSON.parse(userSettings.data);
      const migrated = externalizeCompanionAssets(user.id, parsed);
      const serialized = JSON.stringify(migrated.settings);
      if (serialized !== userSettings.data) {
        db.prepare('UPDATE user_settings SET data = ?, updatedAt = ? WHERE userId = ?')
          .run(serialized, Date.now(), user.id);
      }
      if (migrated.shouldCleanup) cleanupCompanionAssets(user.id, migrated.retainedPaths);
      res.setHeader('X-ComfyForge-Settings-Source', 'user');
      return res.json(migrated.settings);
    } catch (error) {
      if (error instanceof CompanionAssetError) return res.status(error.statusCode).json({ error: error.message });
      return res.status(500).json({ error: 'Unable to migrate companion settings' });
    }
  }

  const globalSettings = db.prepare('SELECT data FROM settings WHERE id = 1').get() as any;
  try {
    const parsed = globalSettings ? JSON.parse(globalSettings.data) : {};
    const migrated = externalizeCompanionAssets(user.id, parsed);
    if (migrated.shouldCleanup) cleanupCompanionAssets(user.id, migrated.retainedPaths);
    res.setHeader('X-ComfyForge-Settings-Source', globalSettings ? 'global' : 'default');
    return res.json(migrated.settings);
  } catch (error) {
    if (error instanceof CompanionAssetError) return res.status(error.statusCode).json({ error: error.message });
    return res.status(500).json({ error: 'Unable to load companion settings' });
  }
});

router.post('/', authenticate, (req, res) => {
  const user = (req as any).user;
  try {
    const migrated = externalizeCompanionAssets(user.id, req.body);
    db.prepare(`
      INSERT INTO user_settings (userId, data, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET
        data = excluded.data,
        updatedAt = excluded.updatedAt
    `).run(user.id, JSON.stringify(migrated.settings), Date.now());
    if (migrated.shouldCleanup) cleanupCompanionAssets(user.id, migrated.retainedPaths);
    return res.json({ success: true, settings: migrated.settings });
  } catch (error) {
    if (error instanceof CompanionAssetError) return res.status(error.statusCode).json({ error: error.message });
    return res.status(500).json({ error: 'Unable to save settings' });
  }
});

export default router;
