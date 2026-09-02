import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../services/database';
import { authenticate } from '../middleware/auth';
import {
  rebuildPromptGroupCacheForUser,
  rebuildPromptGroupSummariesForUser,
  refreshPromptGroupSummariesForMessage,
} from '../services/prompt-group-cache';
import { deleteFiles } from '../services/image';
import { withParsedRandomSelections } from '../services/message-metadata';
import { attachPromptTags } from '../services/prompt-tags';

const router = express.Router();
const getRouteParam = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] || '' : value || '';
const DEFAULT_MESSAGE_PAGE_SIZE = 60;
const MAX_MESSAGE_PAGE_SIZE = 120;
const MESSAGE_FIELDS = `id, role, text, prompt, generationPrompt, imageUrl, thumbnailUrl,
  model, width, height, steps, cfg, workflow, status, timestamp, seed, isFavorite,
  isPromptFavorite, duration, generationStartedAt, sampler, scheduler, randomSelections,
  photoFilterId, photoFilterLabel, photoFilterPrompt, comparisonMessageId`;

const sessionListSelect = `
  SELECT
    s.id,
    s.title,
    s.updatedAt,
    s.isArchived,
    CASE
      WHEN EXISTS(
        SELECT 1 FROM messages m
        WHERE m.sessionId = s.id AND m.status IN ('pending', 'preparing', 'processing')
      ) THEN 'processing'
      WHEN COALESCE(s.lastImageAt, 0) > COALESCE(s.lastViewedAt, 0) THEN 'unseen'
      ELSE 'idle'
    END AS generationStatus
  FROM sessions s
  WHERE s.isArchived = ? AND s.userId = ?
`;

const listSessions = (req: express.Request, res: express.Response, isArchived: number) => {
  const user = (req as any).user;
  const requestedLimit = Number(req.query.limit);
  const paginated = Number.isFinite(requestedLimit) || req.query.includeCursor === 'true';
  if (!paginated) {
    return res.json(db.prepare(`${sessionListSelect} ORDER BY s.updatedAt DESC, s.id DESC`).all(isArchived, user.id));
  }

  const limit = Math.min(100, Math.max(1, Math.round(requestedLimit || 50)));
  const beforeUpdatedAt = Number(req.query.beforeUpdatedAt);
  const beforeId = typeof req.query.beforeId === 'string' ? req.query.beforeId.trim() : '';
  const hasCursor = Number.isFinite(beforeUpdatedAt) && beforeUpdatedAt > 0 && Boolean(beforeId);
  const cursorSql = hasCursor
    ? 'AND (s.updatedAt < ? OR (s.updatedAt = ? AND s.id < ?))'
    : '';
  const params = hasCursor
    ? [isArchived, user.id, beforeUpdatedAt, beforeUpdatedAt, beforeId]
    : [isArchived, user.id];
  const rows = db.prepare(`
    ${sessionListSelect}
    ${cursorSql}
    ORDER BY s.updatedAt DESC, s.id DESC
    LIMIT ?
  `).all(...params, limit + 1) as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const pinnedId = typeof req.query.pinnedId === 'string' ? req.query.pinnedId.trim().slice(0, 200) : '';
  if (pinnedId && !items.some(item => item.id === pinnedId)) {
    const pinned = db.prepare(`${sessionListSelect} AND s.id = ?`).get(isArchived, user.id, pinnedId) as Record<string, unknown> | undefined;
    if (pinned) items.push(pinned);
  }
  const total = req.query.includeTotal === 'true'
    ? (db.prepare('SELECT COUNT(*) AS total FROM sessions WHERE isArchived = ? AND userId = ?')
        .get(isArchived, user.id) as { total: number }).total
    : undefined;
  return res.json({
    items,
    hasMore,
    nextCursor: hasMore && last
      ? { updatedAt: Number(last.updatedAt), id: String(last.id) }
      : null,
    ...(total === undefined ? {} : { total }),
  });
};

router.get('/', authenticate, (req, res) => listSessions(req, res, 0));

router.get('/archives', authenticate, (req, res) => listSessions(req, res, 1));

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

  if (req.query.all === 'true') {
    const messages = db.prepare(`
      SELECT ${MESSAGE_FIELDS} FROM messages
      WHERE sessionId = ? ORDER BY timestamp ASC, id ASC
    `).all(req.params.id) as Record<string, unknown>[];
    const enrichedMessages = attachPromptTags(db, messages.map(withParsedRandomSelections), 'id');
    return res.json({ ...session, messages: enrichedMessages, hasMore: false, nextCursor: null });
  }

  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(MAX_MESSAGE_PAGE_SIZE, Math.max(1, Math.round(requestedLimit)))
    : DEFAULT_MESSAGE_PAGE_SIZE;
  const beforeTimestamp = Number(req.query.beforeTimestamp);
  const beforeId = typeof req.query.beforeId === 'string' ? req.query.beforeId : '';
  const hasCursor = Number.isFinite(beforeTimestamp) && beforeId.length > 0;

  const rows = (hasCursor
    ? db.prepare(`
        SELECT ${MESSAGE_FIELDS} FROM messages
        WHERE sessionId = ? AND (timestamp < ? OR (timestamp = ? AND id < ?))
        ORDER BY timestamp DESC, id DESC LIMIT ?
      `).all(req.params.id, beforeTimestamp, beforeTimestamp, beforeId, limit + 1)
    : db.prepare(`
        SELECT ${MESSAGE_FIELDS} FROM messages
        WHERE sessionId = ? ORDER BY timestamp DESC, id DESC LIMIT ?
      `).all(req.params.id, limit + 1)) as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const enrichedMessages = attachPromptTags(db, page.map(withParsedRandomSelections), 'id');
  const oldest = page[0];
  return res.json({
    ...session,
    messages: enrichedMessages,
    hasMore,
    nextCursor: hasMore && oldest
      ? { timestamp: Number(oldest.timestamp), id: String(oldest.id) }
      : null,
  });
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

  if (req.query.onlyIfEmpty === 'true') {
    const content = db.prepare('SELECT COUNT(*) AS count FROM messages WHERE sessionId = ?')
      .get(req.params.id) as { count: number };
    if (content.count > 0) {
      return res.status(409).json({
        code: 'SESSION_NOT_EMPTY',
        error: 'Session contains messages',
      });
    }
  }

  const messages = db.prepare('SELECT imageUrl, thumbnailUrl FROM messages WHERE sessionId = ? AND imageUrl IS NOT NULL').all(req.params.id) as any[];
  deleteFiles(messages);
  
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  rebuildPromptGroupSummariesForUser(user.id);
  res.json({ success: true });
});

router.patch('/:id/archive', authenticate, (req, res) => {
  const user = (req as any).user;
  db.prepare('UPDATE sessions SET isArchived = ? WHERE id = ? AND userId = ?').run(req.body.isArchived ? 1 : 0, req.params.id, user.id);
  rebuildPromptGroupSummariesForUser(user.id);
  res.json({ success: true, isArchived: req.body.isArchived });
});

router.post('/archive-all', authenticate, (req, res) => {
  const user = (req as any).user;
  db.prepare('UPDATE sessions SET isArchived = 1 WHERE isArchived = 0 AND userId = ?').run(user.id);
  rebuildPromptGroupSummariesForUser(user.id);
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
  rebuildPromptGroupSummariesForUser(user.id);
  res.json({ success: true, deleted: result.changes, scope });
});

router.patch('/:sessionId/message/:messageId/favorite', authenticate, (req, res) => {
  const user = (req as any).user;
  const sessionId = getRouteParam(req.params.sessionId);
  const messageId = getRouteParam(req.params.messageId);
  const { isFavorite } = req.body;

  const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND userId = ?').get(sessionId, user.id);
  if (!session) return res.status(403).json({ error: 'Unauthorized' });

  db.prepare('UPDATE messages SET isFavorite = ? WHERE id = ? AND sessionId = ?').run(isFavorite ? 1 : 0, messageId, sessionId);
  refreshPromptGroupSummariesForMessage(messageId);
  res.json({ success: true, isFavorite });
});

router.patch('/:sessionId/message/:messageId/prompt-favorite', authenticate, (req, res) => {
  const user = (req as any).user;
  const sessionId = getRouteParam(req.params.sessionId);
  const messageId = getRouteParam(req.params.messageId);
  const isPromptFavorite = req.body.isPromptFavorite ? 1 : 0;

  const result = db.prepare(`
    UPDATE messages
    SET isPromptFavorite = ?
    WHERE id = ? AND sessionId = ? AND role = 'bot'
      AND sessionId IN (SELECT id FROM sessions WHERE userId = ?)
  `).run(isPromptFavorite, messageId, sessionId, user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Prompt introuvable' });

  refreshPromptGroupSummariesForMessage(messageId);
  res.json({ success: true, isPromptFavorite });
});

router.delete('/:sessionId/message/:messageId', authenticate, (req, res) => {
  const user = (req as any).user;
  const session = db.prepare('SELECT id FROM sessions WHERE id = ? AND userId = ?').get(req.params.sessionId, user.id);
  if (!session) return res.status(403).json({ error: 'Unauthorized' });

  const sessionMessages = db.prepare(`
    SELECT id, role, text, prompt, imageUrl, thumbnailUrl, isFavorite, isPromptFavorite,
      comparisonSourceId, manualGroupId
    FROM messages
    WHERE sessionId = ?
    ORDER BY timestamp ASC, id ASC
  `).all(req.params.sessionId) as any[];
  const messageIndex = sessionMessages.findIndex(candidate => candidate.id === req.params.messageId);
  const message = sessionMessages[messageIndex];
  const isPair = (userMessage: any, botMessage: any) => (
    userMessage?.role === 'user'
    && botMessage?.role === 'bot'
    && Boolean(String(userMessage.text || '').trim())
    && String(botMessage.prompt || '').trim() === String(userMessage.text || '').trim()
  );
  const linkedMessage = message?.role === 'user' && isPair(message, sessionMessages[messageIndex + 1])
    ? sessionMessages[messageIndex + 1]
    : message?.role === 'bot' && isPair(sessionMessages[messageIndex - 1], message)
      ? sessionMessages[messageIndex - 1]
      : undefined;
  const messagesToDelete = [message, linkedMessage].filter(Boolean);
  const deletedMessageIds = messagesToDelete.map(candidate => candidate.id);
  const affectedManualGroupIds = new Set(messagesToDelete
    .map(deletedMessage => deletedMessage.manualGroupId)
    .filter(Boolean));
  if (messagesToDelete.length) deleteFiles(messagesToDelete);

  db.transaction(() => {
    for (const deletedMessage of messagesToDelete) {
      db.prepare(`
        DELETE FROM comparison_preferences
        WHERE userId = ? AND (
          sourceMessageId = ? OR firstMessageId = ? OR secondMessageId = ? OR preferredMessageId = ?
        )
      `).run(user.id, deletedMessage.id, deletedMessage.id, deletedMessage.id, deletedMessage.id);
      if (deletedMessage.comparisonSourceId) {
        const nextComparison = db.prepare(`
          SELECT id FROM messages
          WHERE comparisonSourceId = ? AND id <> ?
          ORDER BY timestamp DESC LIMIT 1
        `).get(deletedMessage.comparisonSourceId, deletedMessage.id) as { id: string } | undefined;
        db.prepare(`
          UPDATE messages SET
            isFavorite = CASE WHEN ? = 1 THEN 1 ELSE isFavorite END,
            isPromptFavorite = CASE WHEN ? = 1 THEN 1 ELSE isPromptFavorite END,
            comparisonMessageId = ?
          WHERE id = ? AND sessionId = ?
        `).run(
          deletedMessage.isFavorite === 1 ? 1 : 0,
          deletedMessage.isPromptFavorite === 1 ? 1 : 0,
          nextComparison?.id || null,
          deletedMessage.comparisonSourceId,
          req.params.sessionId
        );
      } else {
        db.prepare('UPDATE messages SET comparisonMessageId = NULL, comparisonSourceId = NULL WHERE comparisonMessageId = ? OR comparisonSourceId = ?')
          .run(deletedMessage.id, deletedMessage.id);
      }
      db.prepare('DELETE FROM messages WHERE id = ? AND sessionId = ?').run(deletedMessage.id, req.params.sessionId);
      db.prepare('DELETE FROM queue WHERE messageId = ?').run(deletedMessage.id);
    }

    for (const manualGroupId of affectedManualGroupIds) {
      const remaining = db.prepare(`
        SELECT COUNT(*) AS count
        FROM messages
        WHERE manualGroupId = ?
          AND sessionId IN (SELECT id FROM sessions WHERE userId = ?)
      `).get(manualGroupId, user.id) as { count: number };
      if (remaining.count < 2) {
        db.prepare(`
          UPDATE messages
          SET manualGroupId = NULL, isGroupCover = 0
          WHERE manualGroupId = ?
            AND sessionId IN (SELECT id FROM sessions WHERE userId = ?)
        `).run(manualGroupId, user.id);
      }
    }
  })();
  if (affectedManualGroupIds.size > 0) rebuildPromptGroupCacheForUser(user.id);
  else rebuildPromptGroupSummariesForUser(user.id);
  res.json({ success: true, deletedMessageIds });
});

export default router;
