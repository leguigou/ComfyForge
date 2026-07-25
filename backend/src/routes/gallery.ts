import express from 'express';
import db from '../services/database';
import { authenticate } from '../middleware/auth';
import { withParsedRandomSelections } from '../services/message-metadata';

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  const user = (req as any).user;
  const limit = parseInt(req.query.limit as string) || 25;
  const offset = parseInt(req.query.offset as string) || 0;
  const onlyArchived = req.query.includeArchived === 'true';
  const favoritesOnly = req.query.favoritesOnly === 'true';
  
  let query = `
    SELECT m.sessionId, m.id as messageId, m.imageUrl, m.thumbnailUrl, m.prompt, m.text, m.timestamp, m.model, m.width, m.height, m.steps, m.cfg, m.workflow, m.seed, m.isFavorite, m.duration, m.sampler, m.scheduler, m.randomSelections
    FROM messages m JOIN sessions s ON m.sessionId = s.id
    WHERE m.imageUrl IS NOT NULL AND s.userId = ?
  `;
  
  const params: any[] = [user.id];
  
  if (favoritesOnly) {
    query += ` AND m.isFavorite = 1`;
  } else {
    query += ` AND s.isArchived = ?`;
    params.push(onlyArchived ? 1 : 0);
  }
  
  query += ` ORDER BY m.timestamp DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  const results = db.prepare(query).all(...params) as Record<string, unknown>[];
  res.json(results.map(withParsedRandomSelections));
});

export default router;
