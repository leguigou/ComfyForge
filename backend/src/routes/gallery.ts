import express from 'express';
import db from '../services/database';
import { authenticate } from '../middleware/auth';
import { withParsedRandomSelections } from '../services/message-metadata';
import { attachPromptTags } from '../services/prompt-tags';

const router = express.Router();

router.get('/tags', authenticate, (req, res) => {
  const user = (req as any).user;
  const tags = db.prepare(`
    SELECT t.id AS slug, t.category, t.labelFr, t.labelEn, COUNT(DISTINCT mt.messageId) AS count
    FROM tags t
    JOIN message_tags mt ON mt.tagId = t.id
    JOIN messages m ON m.id = mt.messageId
    JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ? AND m.imageUrl IS NOT NULL
    GROUP BY t.id, t.category, t.labelFr, t.labelEn
    ORDER BY count DESC, t.labelFr ASC
  `).all(user.id);
  res.json(tags);
});

router.get('/', authenticate, (req, res) => {
  const user = (req as any).user;
  const limit = parseInt(req.query.limit as string) || 25;
  const offset = parseInt(req.query.offset as string) || 0;
  const onlyArchived = req.query.includeArchived === 'true';
  const favoritesOnly = req.query.favoritesOnly === 'true';
  const promptFavoritesOnly = req.query.promptFavoritesOnly === 'true';
  const rawTags = Array.isArray(req.query.tag) ? req.query.tag : [req.query.tag];
  const selectedTags = [...new Set(rawTags
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim())
    .filter(Boolean))];
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 300) : '';
  
  let query = `
    SELECT m.sessionId, m.id as messageId, m.imageUrl, m.thumbnailUrl, m.prompt, m.text, m.generationPrompt, m.timestamp, m.model, m.width, m.height, m.steps, m.cfg, m.workflow, m.seed, m.isFavorite, m.isPromptFavorite, m.duration, m.sampler, m.scheduler, m.randomSelections
    FROM messages m JOIN sessions s ON m.sessionId = s.id
    WHERE m.imageUrl IS NOT NULL AND s.userId = ?
  `;
  
  const params: any[] = [user.id];
  
  if (favoritesOnly) {
    query += ` AND m.isFavorite = 1`;
  }
  if (promptFavoritesOnly) {
    query += ` AND m.isPromptFavorite = 1`;
  }
  if (!favoritesOnly && !promptFavoritesOnly) {
    query += ` AND s.isArchived = ?`;
    params.push(onlyArchived ? 1 : 0);
  }
  if (selectedTags.length > 0) {
    query += ` AND m.id IN (
      SELECT mt.messageId
      FROM message_tags mt
      WHERE mt.tagId IN (${selectedTags.map(() => '?').join(',')})
      GROUP BY mt.messageId
      HAVING COUNT(DISTINCT mt.tagId) = ?
    )`;
    params.push(...selectedTags, selectedTags.length);
  }
  if (search) {
    const escapedSearch = search.toLowerCase().replace(/[\\%_]/g, '\\$&');
    query += ` AND lower(
      COALESCE(m.generationPrompt, '') || ' ' ||
      COALESCE(m.prompt, '') || ' ' ||
      COALESCE(m.text, '')
    ) LIKE ? ESCAPE '\\'`;
    params.push(`%${escapedSearch}%`);
  }
  
  query += ` ORDER BY m.timestamp DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  const results = db.prepare(query).all(...params) as Record<string, unknown>[];
  const enrichedResults = attachPromptTags(db, results.map(withParsedRandomSelections), 'messageId');
  res.json(enrichedResults);
});

export default router;
