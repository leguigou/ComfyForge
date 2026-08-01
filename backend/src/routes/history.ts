import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../services/database';
import { authenticate } from '../middleware/auth';
import { deleteFiles } from '../services/image';
import { withParsedRandomSelections } from '../services/message-metadata';
import { attachPromptTags } from '../services/prompt-tags';

const router = express.Router();

const sessionListQuery = `
  SELECT
    s.id,
    s.title,
    s.updatedAt,
    s.isArchived,
    CASE
      WHEN EXISTS(
        SELECT 1 FROM messages m
        WHERE m.sessionId = s.id AND m.status IN ('pending', 'processing')
      ) THEN 'processing'
      WHEN COALESCE(s.lastImageAt, 0) > COALESCE(s.lastViewedAt, 0) THEN 'unseen'
      ELSE 'idle'
    END AS generationStatus
  FROM sessions s
  WHERE s.isArchived = ? AND s.userId = ?
  ORDER BY s.updatedAt DESC
`;

router.get('/', authenticate, (req, res) => {
  const user = (req as any).user;
  res.json(db.prepare(sessionListQuery).all(0, user.id));
});

router.get('/archives', authenticate, (req, res) => {
  const user = (req as any).user;
  res.json(db.prepare(sessionListQuery).all(1, user.id));
});

router.post('/', authenticate, (req, res) => {
  const user = (req as any).user;
  const newSession = { id: uuidv4(), userId: user.id, title: 'New Chat', updatedAt: Date.now(), isArchived: 0 };
  db.prepare('INSERT INTO sessions (id, userId, title, updatedAt, isArchived) VALUES (?, ?, ?, ?, ?)')
    .run(newSession.id, newSession.userId, newSession.title, newSession.updatedAt, 0);
  res.json(newSession);
});

router.get('/:id', authenticate, (req, res) => {
  const user = (req as any).user;
  const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND userId = ?').get(req.params.id, user.id) as any;
  if (!session) return res.json({ error: 'Not found' });
  const messages = db.prepare('SELECT id, role, text, prompt, generationPrompt, imageUrl, thumbnailUrl, model, width, height, steps, cfg, workflow, status, timestamp, seed, isFavorite, isPromptFavorite, duration, generationStartedAt, sampler, scheduler, randomSelections, comparisonMessageId FROM messages WHERE sessionId = ? ORDER BY timestamp ASC').all(req.params.id) as Record<string, unknown>[];
  const enrichedMessages = attachPromptTags(db, messages.map(withParsedRandomSelections), 'id');
  res.json({ ...session, messages: enrichedMessages });
});

router.patch('/:id', authenticate, (req, res) => {
  const user = (req as any).user;
  db.prepare('UPDATE sessions SET title = ? WHERE id = ? AND userId = ?').run(req.body.title, req.params.id, user.id);
  res.json({ success: true, title: req.body.title });
});

router.patch('/:id/viewed', authenticate, (req, res) => {
  const user = (req as any).user;
  const result = db.prepare('UPDATE sessions SET lastViewedAt = ? WHERE id = ? AND userId = ?')
    .run(Date.now(), req.params.id, user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Session not found' });
  res.json({ success: true });
});

router.delete('/:id', authenticate, (req, res) => {
  const user = (req as any).user;
  const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND userId = ?').get(req.params.id, user.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const messages = db.prepare('SELECT imageUrl, thumbnailUrl FROM messages WHERE sessionId = ? AND imageUrl IS NOT NULL').all(req.params.id) as any[];
  deleteFiles(messages);
  
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.patch('/:id/archive', authenticate, (req, res) => {
  const user = (req as any).user;
  db.prepare('UPDATE sessions SET isArchived = ? WHERE id = ? AND userId = ?').run(req.body.isArchived ? 1 : 0, req.params.id, user.id);
  res.json({ success: true, isArchived: req.body.isArchived });
});

router.post('/archive-all', authenticate, (req, res) => {
  const user = (req as any).user;
  db.prepare('UPDATE sessions SET isArchived = 1 WHERE isArchived = 0 AND userId = ?').run(user.id);
  res.json({ success: true });
});

router.delete('/all/:scope', authenticate, (req, res) => {
  const user = (req as any).user;
  const scope = Array.isArray(req.params.scope) ? req.params.scope[0] : req.params.scope;
  if (!['active', 'archived', 'all'].includes(scope)) {
    return res.status(400).json({ error: 'Invalid deletion scope' });
  }
  const archiveFilter = scope === 'active'
    ? 'AND s.isArchived = 0'
    : scope === 'archived'
      ? 'AND s.isArchived = 1'
      : '';
  const messages = db.prepare(`
    SELECT m.imageUrl, m.thumbnailUrl
    FROM messages m
    JOIN sessions s ON m.sessionId = s.id
    WHERE s.userId = ? ${archiveFilter} AND m.imageUrl IS NOT NULL
  `).all(user.id) as any[];
  deleteFiles(messages);

  const result = db.prepare(`
    DELETE FROM sessions
    WHERE userId = ?
      ${scope === 'active' ? 'AND isArchived = 0' : scope === 'archived' ? 'AND isArchived = 1' : ''}
  `).run(user.id);
  res.json({ success: true, deleted: result.changes, scope });
});

router.patch('/:sessionId/message/:messageId/favorite', authenticate, (req, res) => {
  const user = (req as any).user;
  const { sessionId, messageId } = req.params;
  const { isFavorite } = req.body;

  const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND userId = ?').get(sessionId, user.id);
  if (!session) return res.status(403).json({ error: 'Unauthorized' });

  db.prepare('UPDATE messages SET isFavorite = ? WHERE id = ? AND sessionId = ?').run(isFavorite ? 1 : 0, messageId, sessionId);
  res.json({ success: true, isFavorite });
});

router.patch('/:sessionId/message/:messageId/prompt-favorite', authenticate, (req, res) => {
  const user = (req as any).user;
  const { sessionId, messageId } = req.params;
  const isPromptFavorite = req.body.isPromptFavorite ? 1 : 0;

  const result = db.prepare(`
    UPDATE messages
    SET isPromptFavorite = ?
    WHERE id = ? AND sessionId = ? AND role = 'bot'
      AND sessionId IN (SELECT id FROM sessions WHERE userId = ?)
  `).run(isPromptFavorite, messageId, sessionId, user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Prompt introuvable' });

  res.json({ success: true, isPromptFavorite });
});

router.delete('/:sessionId/message/:messageId', authenticate, (req, res) => {
  const user = (req as any).user;
  const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND userId = ?').get(req.params.sessionId, user.id);
  if (!session) return res.status(403).json({ error: 'Unauthorized' });

  const message = db.prepare(`
    SELECT id, imageUrl, thumbnailUrl, isFavorite, isPromptFavorite, comparisonSourceId
    FROM messages WHERE id = ? AND sessionId = ?
  `).get(req.params.messageId, req.params.sessionId) as any;
  if (message) deleteFiles([message]);

  db.transaction(() => {
    db.prepare(`
      DELETE FROM comparison_preferences
      WHERE userId = ? AND (
        sourceMessageId = ? OR firstMessageId = ? OR secondMessageId = ? OR preferredMessageId = ?
      )
    `).run(user.id, req.params.messageId, req.params.messageId, req.params.messageId, req.params.messageId);
    if (message?.comparisonSourceId) {
      const nextComparison = db.prepare(`
        SELECT id FROM messages
        WHERE comparisonSourceId = ? AND id <> ?
        ORDER BY timestamp DESC LIMIT 1
      `).get(message.comparisonSourceId, message.id) as { id: string } | undefined;
      db.prepare(`
        UPDATE messages SET
          isFavorite = CASE WHEN ? = 1 THEN 1 ELSE isFavorite END,
          isPromptFavorite = CASE WHEN ? = 1 THEN 1 ELSE isPromptFavorite END,
          comparisonMessageId = ?
        WHERE id = ? AND sessionId = ?
      `).run(
        message.isFavorite === 1 ? 1 : 0,
        message.isPromptFavorite === 1 ? 1 : 0,
        nextComparison?.id || null,
        message.comparisonSourceId,
        req.params.sessionId
      );
    } else {
      db.prepare('UPDATE messages SET comparisonMessageId = NULL, comparisonSourceId = NULL WHERE comparisonMessageId = ? OR comparisonSourceId = ?')
        .run(req.params.messageId, req.params.messageId);
    }
    db.prepare('DELETE FROM messages WHERE id = ? AND sessionId = ?').run(req.params.messageId, req.params.sessionId);
    db.prepare('DELETE FROM queue WHERE messageId = ?').run(req.params.messageId);
  })();
  res.json({ success: true });
});

export default router;
