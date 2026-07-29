import db from './database';

export type AuditLevel = 'debug' | 'info' | 'warning' | 'error';
export type AuditSource = 'comfyui' | 'llm';
export type AuditDirection = 'inbound' | 'outbound';

export interface AuditLogInput {
  level?: AuditLevel;
  source: AuditSource;
  direction: AuditDirection;
  event: string;
  message: string;
  status?: string;
  durationMs?: number;
  userId?: string;
  sessionId?: string;
  messageId?: string;
  details?: unknown;
}

const MAX_LOGS = 5000;
const RETENTION_MS = 5 * 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const MAX_STRING_LENGTH = 8000;
const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|api[-_]?key|signedcookies?)/i;
let insertsSincePrune = 0;
let retentionTimer: NodeJS.Timeout | null = null;

const sanitize = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) return value;
  if (depth > 7) return '[profondeur limitée]';
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}… [${value.length - MAX_STRING_LENGTH} caractères masqués]`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} octets]`;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 150)
      .map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[MASQUÉ]' : sanitize(item, depth + 1)]));
  }
  return String(value);
};

const safeJson = (details: unknown) => {
  if (details === undefined) return null;
  try {
    return JSON.stringify(sanitize(details));
  } catch {
    return JSON.stringify({ value: '[détails non sérialisables]' });
  }
};

export const writeAuditLog = (input: AuditLogInput) => {
  try {
    db.prepare(`
      INSERT INTO audit_logs (
        timestamp, level, source, direction, event, message, status, durationMs,
        userId, sessionId, messageId, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Date.now(),
      input.level || 'info',
      input.source,
      input.direction,
      input.event.slice(0, 120),
      input.message.slice(0, 1000),
      input.status?.slice(0, 80) || null,
      Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs!)) : null,
      input.userId || null,
      input.sessionId || null,
      input.messageId || null,
      safeJson(input.details)
    );

    insertsSincePrune++;
    if (insertsSincePrune >= 100) {
      insertsSincePrune = 0;
      purgeExpiredAuditLogs();
      db.prepare(`
        DELETE FROM audit_logs
        WHERE id NOT IN (SELECT id FROM audit_logs ORDER BY id DESC LIMIT ?)
      `).run(MAX_LOGS);
    }
  } catch (error) {
    console.error('[AuditLog] Failed to persist log:', error);
  }
};

export const sanitizeAuditDetails = sanitize;

export const purgeExpiredAuditLogs = (now = Date.now()) => {
  try {
    return db.prepare('DELETE FROM audit_logs WHERE timestamp < ?').run(now - RETENTION_MS).changes;
  } catch (error) {
    console.error('[AuditLog] Failed to purge expired logs:', error);
    return 0;
  }
};

export const startAuditLogRetention = () => {
  purgeExpiredAuditLogs();
  if (retentionTimer) return;
  retentionTimer = setInterval(purgeExpiredAuditLogs, PURGE_INTERVAL_MS);
  retentionTimer.unref();
};
