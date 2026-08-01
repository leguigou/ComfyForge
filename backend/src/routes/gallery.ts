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

router.get('/random-prompt', authenticate, (req, res) => {
  const user = (req as any).user;
  const source = req.query.source === 'favorite' ? 'favorite' : 'liked';
  const favoriteColumn = source === 'favorite' ? 'm.isFavorite' : 'm.isPromptFavorite';
  const result = db.prepare(`
    SELECT COALESCE(
      NULLIF(TRIM(m.generationPrompt), ''),
      NULLIF(TRIM(m.prompt), ''),
      TRIM(m.text)
    ) AS prompt
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ?
      AND m.role = 'bot'
      AND ${favoriteColumn} = 1
      AND TRIM(COALESCE(
        NULLIF(TRIM(m.generationPrompt), ''),
        NULLIF(TRIM(m.prompt), ''),
        TRIM(m.text)
      )) <> ''
    GROUP BY COALESCE(
      NULLIF(TRIM(m.generationPrompt), ''),
      NULLIF(TRIM(m.prompt), ''),
      TRIM(m.text)
    )
    ORDER BY RANDOM()
    LIMIT 1
  `).get(user.id) as { prompt: string } | undefined;

  if (!result?.prompt) {
    return res.status(404).json({
      code: source === 'favorite' ? 'NO_FAVORITE_PROMPTS' : 'NO_LIKED_PROMPTS',
      error: 'No matching saved prompt'
    });
  }

  res.json({ prompt: result.prompt, source });
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
  
  let filteredSource = `
    FROM messages m JOIN sessions s ON m.sessionId = s.id
    WHERE m.imageUrl IS NOT NULL AND s.userId = ?
  `;
  
  const params: any[] = [user.id];
  
  if (favoritesOnly) {
    filteredSource += ` AND m.isFavorite = 1`;
  }
  if (promptFavoritesOnly) {
    filteredSource += ` AND m.isPromptFavorite = 1`;
  }
  if (!favoritesOnly && !promptFavoritesOnly) {
    filteredSource += ` AND s.isArchived = ?`;
    params.push(onlyArchived ? 1 : 0);
  }
  if (selectedTags.length > 0) {
    filteredSource += ` AND m.id IN (
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
    filteredSource += ` AND lower(
      COALESCE(m.generationPrompt, '') || ' ' ||
      COALESCE(m.prompt, '') || ' ' ||
      COALESCE(m.text, '')
    ) LIKE ? ESCAPE '\\'`;
    params.push(`%${escapedSearch}%`);
  }

  const totalRow = db.prepare(`SELECT COUNT(*) AS total ${filteredSource}`)
    .get(...params) as { total: number };
  const results = db.prepare(`
    SELECT m.sessionId, m.id as messageId, m.imageUrl, m.thumbnailUrl, m.prompt, m.text,
      m.generationPrompt, m.timestamp, m.model, m.width, m.height, m.steps, m.cfg,
      m.workflow, m.seed, m.isFavorite, m.isPromptFavorite, m.duration, m.sampler,
      m.scheduler, m.randomSelections, m.comparisonMessageId
    ${filteredSource}
    ORDER BY m.timestamp DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Record<string, unknown>[];
  const enrichedResults = attachPromptTags(db, results.map(withParsedRandomSelections), 'messageId');
  if (req.query.includeTotal === 'true') {
    return res.json({ items: enrichedResults, total: totalRow.total });
  }
  res.json(enrichedResults);
});

export default router;
