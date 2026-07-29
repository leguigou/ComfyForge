import express from 'express';
import db from '../services/database';
import { requireAdmin } from '../middleware/auth';
import type { AuditLevel, AuditSource } from '../services/audit-log';

const router = express.Router();
const validLevels = new Set<AuditLevel>(['debug', 'info', 'warning', 'error']);
const validSources = new Set<AuditSource>(['comfyui', 'llm']);

router.get('/', requireAdmin, (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 400));
  const levels = String(req.query.levels || '').split(',').filter(value => validLevels.has(value as AuditLevel));
  const sources = String(req.query.sources || '').split(',').filter(value => validSources.has(value as AuditSource));
  const search = String(req.query.search || '').trim().slice(0, 200);
  const clauses: string[] = ['userId = ?', "source IN ('comfyui', 'llm')"];
  const params: Array<string | number> = [req.user!.id];

  if (levels.length) {
    clauses.push(`level IN (${levels.map(() => '?').join(',')})`);
    params.push(...levels);
  }
  if (sources.length) {
    clauses.push(`source IN (${sources.map(() => '?').join(',')})`);
    params.push(...sources);
  }
  if (search) {
    clauses.push(`(
      lower(message) LIKE ? OR lower(event) LIKE ? OR lower(COALESCE(status, '')) LIKE ?
      OR lower(COALESCE(details, '')) LIKE ?
    )`);
    const pattern = `%${search.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`;
    params.push(pattern, pattern, pattern, pattern);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT id, timestamp, level, source,
           COALESCE(direction, CASE WHEN event LIKE '%.request' THEN 'outbound' ELSE 'inbound' END) AS direction,
           event, message, status, durationMs,
           userId, sessionId, messageId, details
    FROM audit_logs
    ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, limit) as Array<Record<string, unknown>>;

  const counts = db.prepare(`
    SELECT level, COUNT(*) AS count
    FROM audit_logs
    WHERE userId = ? AND source IN ('comfyui', 'llm')
    GROUP BY level
  `).all(req.user!.id);

  res.json({
    logs: rows.reverse().map(row => ({
      ...row,
      details: row.details ? JSON.parse(String(row.details)) : null
    })),
    counts
  });
});

export default router;
