import express from 'express';
import db from '../services/database';
import { requireAdmin } from '../middleware/auth';
import { broadcastToSession, getQueueLimits } from '../services/queue';

const router = express.Router();

router.get('/', requireAdmin, (_req, res) => {
  const now = Date.now();
  const items = db.prepare(`
    SELECT
      q.id,
      q.messageId,
      q.userId,
      u.username,
      q.sessionId,
      s.title AS sessionTitle,
      q.status,
      q.createdAt,
      substr(COALESCE(q.originalPrompt, q.prompt, ''), 1, 240) AS promptPreview,
      m.model,
      m.workflow
    FROM queue q
    LEFT JOIN users u ON u.id = q.userId
    LEFT JOIN sessions s ON s.id = q.sessionId
    LEFT JOIN messages m ON m.id = q.messageId
    WHERE q.status IN ('pending', 'processing')
    ORDER BY CASE q.status WHEN 'processing' THEN 0 ELSE 1 END, q.createdAt ASC, q.id ASC
    LIMIT 500
  `).all() as Array<Record<string, unknown> & { createdAt: number }>;

  const perUser = db.prepare(`
    SELECT q.userId, COALESCE(u.username, q.userId, 'unknown') AS username, u.queueLimit, COUNT(*) AS count,
      MIN(q.createdAt) AS oldestCreatedAt
    FROM queue q
    LEFT JOIN users u ON u.id = q.userId
    WHERE q.status IN ('pending', 'processing')
    GROUP BY q.userId, u.username, u.queueLimit
    ORDER BY oldestCreatedAt ASC
  `).all();

  res.json({
    items: items.map(item => ({ ...item, waitSeconds: Math.max(0, Math.floor((now - item.createdAt) / 1000)) })),
    perUser,
    limits: { batch: getQueueLimits().batch },
    checkedAt: now
  });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const queueId = Number.parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (!Number.isFinite(queueId) || queueId <= 0) return res.status(400).json({ error: 'Invalid queue id' });
  const task = db.prepare(`
    SELECT id, messageId, sessionId, status FROM queue WHERE id = ?
  `).get(queueId) as { id: number; messageId: string; sessionId: string; status: string } | undefined;
  if (!task) return res.status(404).json({ error: 'Queue item not found' });
  if (task.status !== 'pending') {
    return res.status(409).json({
      code: 'QUEUE_ITEM_ALREADY_PROCESSING',
      error: 'A processing task must be interrupted by its owner'
    });
  }

  db.transaction(() => {
    db.prepare('DELETE FROM queue WHERE id = ? AND status = ?').run(queueId, 'pending');
    db.prepare(`
      UPDATE messages SET status = 'failed', text = ?, generationStartedAt = NULL
      WHERE id = ? AND status = 'pending'
    `).run('Annulé par un administrateur', task.messageId);
  })();
  broadcastToSession(task.sessionId, {
    messageId: task.messageId,
    status: 'failed',
    error: 'Annulé par un administrateur'
  });
  res.json({ success: true, queueId, messageId: task.messageId });
});

export default router;
