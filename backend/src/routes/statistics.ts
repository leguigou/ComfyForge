import express from 'express';
import db from '../services/database';
import { authenticate } from '../middleware/auth';

const router = express.Router();

type PeriodRow = {
  timestamp: number;
  status: string | null;
  duration: number | null;
  model: string | null;
  workflow: string | null;
  isFavorite: number | null;
  isPromptFavorite: number | null;
};

const numberValue = (value: unknown) => Number(value) || 0;

const parseRange = (req: express.Request) => {
  const now = Date.now();
  const start = Number(req.query.start);
  const end = Number(req.query.end);
  const timezoneOffset = Math.max(-840, Math.min(840, Number(req.query.timezoneOffset) || 0));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 370 * 24 * 60 * 60 * 1000) {
    return null;
  }
  return {
    start: Math.max(0, Math.round(start)),
    end: Math.min(now + 24 * 60 * 60 * 1000, Math.round(end)),
    timezoneOffset,
  };
};

const bucketKey = (timestamp: number, granularity: 'day' | 'month', timezoneOffset: number) => {
  const localDate = new Date(timestamp - timezoneOffset * 60_000);
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  return granularity === 'month'
    ? `${year}-${month}`
    : `${year}-${month}-${String(localDate.getUTCDate()).padStart(2, '0')}`;
};

router.get('/', authenticate, (req, res) => {
  const userId = (req as any).user.id as string;
  const range = parseRange(req);
  if (!range) return res.status(400).json({ error: 'Invalid statistics range' });

  const granularity = req.query.granularity === 'month' ? 'month' : 'day';
  const duration = range.end - range.start;
  const previousStart = Math.max(0, range.start - duration);

  const rows = db.prepare(`
    SELECT m.timestamp, m.status, m.duration, m.model, m.workflow, m.isFavorite, m.isPromptFavorite
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ? AND m.role = 'bot' AND m.timestamp >= ? AND m.timestamp < ?
  `).all(userId, range.start, range.end) as PeriodRow[];

  const completed = rows.filter(row => row.status === 'completed' && row.duration && row.duration > 0);
  const images = rows.filter(row => row.status === 'completed');
  const failed = rows.filter(row => row.status === 'failed');
  const averageDuration = completed.length
    ? completed.reduce((sum, row) => sum + numberValue(row.duration), 0) / completed.length
    : 0;

  const previous = db.prepare(`
    SELECT
      COUNT(CASE WHEN m.status = 'completed' THEN 1 END) AS images,
      AVG(CASE WHEN m.status = 'completed' AND m.duration > 0 THEN m.duration END) AS averageDuration
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ? AND m.role = 'bot' AND m.timestamp >= ? AND m.timestamp < ?
  `).get(userId, previousStart, range.start) as { images: number; averageDuration: number | null };

  const totals = db.prepare(`
    SELECT
      COUNT(CASE WHEN m.role = 'bot' AND m.status = 'completed' THEN 1 END) AS images,
      COUNT(DISTINCT s.id) AS conversations,
      COUNT(CASE WHEN m.role = 'bot' AND m.isFavorite = 1 THEN 1 END) AS favorites,
      COUNT(CASE WHEN m.role = 'bot' AND m.isPromptFavorite = 1 THEN 1 END) AS likedPrompts,
      MIN(CASE WHEN m.role = 'bot' THEN m.timestamp END) AS firstGenerationAt
    FROM sessions s
    LEFT JOIN messages m ON m.sessionId = s.id
    WHERE s.userId = ?
  `).get(userId) as Record<string, number | null>;

  const seriesMap = new Map<string, { key: string; images: number; attempts: number; durationTotal: number; durationCount: number }>();
  const favoritesSeriesMap = new Map<string, { key: string; favorites: number; likedPrompts: number }>();
  const modelSeriesMap = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const key = bucketKey(row.timestamp, granularity, range.timezoneOffset);
    const bucket = seriesMap.get(key) || { key, images: 0, attempts: 0, durationTotal: 0, durationCount: 0 };
    bucket.attempts++;
    if (row.status === 'completed') bucket.images++;
    if (row.status === 'completed' && row.duration && row.duration > 0) {
      bucket.durationTotal += row.duration;
      bucket.durationCount++;
    }
    seriesMap.set(key, bucket);

    const favoriteBucket = favoritesSeriesMap.get(key) || { key, favorites: 0, likedPrompts: 0 };
    if (row.status === 'completed' && row.isFavorite) favoriteBucket.favorites++;
    if (row.status === 'completed' && row.isPromptFavorite) favoriteBucket.likedPrompts++;
    favoritesSeriesMap.set(key, favoriteBucket);

    if (row.status === 'completed') {
      const modelName = row.model?.trim() || 'Modèle inconnu';
      const modelBuckets = modelSeriesMap.get(modelName) || new Map<string, number>();
      modelBuckets.set(key, (modelBuckets.get(key) || 0) + 1);
      modelSeriesMap.set(modelName, modelBuckets);
    }
  }

  const models = db.prepare(`
    SELECT
      COALESCE(NULLIF(TRIM(m.model), ''), 'Modèle inconnu') AS name,
      COUNT(*) AS uses,
      AVG(CASE WHEN m.duration > 0 THEN m.duration END) AS averageDuration,
      SUM(CASE WHEN m.isFavorite = 1 THEN 1 ELSE 0 END) AS favorites,
      SUM(CASE WHEN m.isPromptFavorite = 1 THEN 1 ELSE 0 END) AS likedPrompts,
      MAX(m.timestamp) AS lastUsedAt
    FROM messages m
    JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ? AND m.role = 'bot' AND m.status = 'completed'
      AND m.timestamp >= ? AND m.timestamp < ?
    GROUP BY COALESCE(NULLIF(TRIM(m.model), ''), 'Modèle inconnu')
    ORDER BY uses DESC, name ASC
  `).all(userId, range.start, range.end);

  const workflows = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(m.workflow), ''), 'Workflow inconnu') AS name,
      COUNT(*) AS uses, AVG(CASE WHEN m.duration > 0 THEN m.duration END) AS averageDuration
    FROM messages m JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ? AND m.role = 'bot' AND m.status = 'completed'
      AND m.timestamp >= ? AND m.timestamp < ?
    GROUP BY COALESCE(NULLIF(TRIM(m.workflow), ''), 'Workflow inconnu')
    ORDER BY uses DESC, name ASC
  `).all(userId, range.start, range.end);

  const tags = db.prepare(`
    SELECT t.id AS slug, t.category, t.labelFr, t.labelEn,
      COUNT(DISTINCT mt.messageId) AS uses,
      COUNT(DISTINCT COALESCE(NULLIF(TRIM(m.generationPrompt), ''), NULLIF(TRIM(m.prompt), ''), m.text)) AS prompts,
      SUM(CASE WHEN m.isFavorite = 1 THEN 1 ELSE 0 END) AS favorites,
      MAX(m.timestamp) AS lastUsedAt
    FROM tags t
    JOIN message_tags mt ON mt.tagId = t.id
    JOIN messages m ON m.id = mt.messageId
    JOIN sessions s ON s.id = m.sessionId
    WHERE s.userId = ? AND m.status = 'completed' AND m.timestamp >= ? AND m.timestamp < ?
    GROUP BY t.id, t.category, t.labelFr, t.labelEn
    ORDER BY uses DESC, t.labelFr ASC
  `).all(userId, range.start, range.end);

  // Audit logs currently have a five-day retention policy. Expose the actual
  // covered window so the dashboard never presents a partial count as complete.
  const llmCoverageStart = Math.min(range.end, Math.max(range.start, Date.now() - 5 * 24 * 60 * 60 * 1000));
  const llm = db.prepare(`
    SELECT
      CASE WHEN event LIKE 'llm.vision.%' THEN 'vision' ELSE 'prompt' END AS kind,
      COALESCE(json_extract(details, '$.model'), 'Modèle inconnu') AS model,
      COUNT(*) AS calls,
      SUM(CASE WHEN event LIKE '%.failed' THEN 1 ELSE 0 END) AS failures,
      AVG(CASE WHEN durationMs > 0 THEN durationMs END) AS averageDurationMs
    FROM audit_logs
    WHERE userId = ? AND source = 'llm' AND direction = 'inbound'
      AND (event = 'llm.response' OR event = 'llm.failed' OR event LIKE 'llm.vision.%')
      AND timestamp >= ? AND timestamp < ?
    GROUP BY kind, model
    ORDER BY calls DESC
  `).all(userId, llmCoverageStart, range.end);

  const llmEventRows = db.prepare(`
    SELECT timestamp, CASE WHEN event LIKE 'llm.vision.%' THEN 'vision' ELSE 'prompt' END AS kind
    FROM audit_logs
    WHERE userId = ? AND source = 'llm' AND direction = 'inbound'
      AND (event = 'llm.response' OR event = 'llm.failed' OR event LIKE 'llm.vision.%')
      AND timestamp >= ? AND timestamp < ?
  `).all(userId, llmCoverageStart, range.end) as Array<{ timestamp: number; kind: 'prompt' | 'vision' }>;
  const llmSeriesMap = new Map<string, { key: string; prompt: number; vision: number }>();
  for (const event of llmEventRows) {
    const key = bucketKey(event.timestamp, granularity, range.timezoneOffset);
    const bucket = llmSeriesMap.get(key) || { key, prompt: 0, vision: 0 };
    bucket[event.kind]++;
    llmSeriesMap.set(key, bucket);
  }

  const sessionCount = db.prepare(`
    SELECT COUNT(DISTINCT s.id) AS count
    FROM sessions s JOIN messages m ON m.sessionId = s.id
    WHERE s.userId = ? AND m.role = 'bot' AND m.timestamp >= ? AND m.timestamp < ?
  `).get(userId, range.start, range.end) as { count: number };

  return res.json({
    range: { ...range, granularity, llmCoverageStart },
    overview: {
      images: images.length,
      attempts: rows.length,
      failed: failed.length,
      successRate: rows.length ? images.length / rows.length : 0,
      averageDuration,
      conversations: sessionCount.count,
      previousImages: numberValue(previous.images),
      previousAverageDuration: numberValue(previous.averageDuration),
    },
    totals: {
      images: numberValue(totals.images),
      conversations: numberValue(totals.conversations),
      favorites: numberValue(totals.favorites),
      likedPrompts: numberValue(totals.likedPrompts),
      firstGenerationAt: totals.firstGenerationAt,
    },
    series: [...seriesMap.values()].map(bucket => ({
      key: bucket.key,
      images: bucket.images,
      attempts: bucket.attempts,
      averageDuration: bucket.durationCount ? bucket.durationTotal / bucket.durationCount : 0,
    })).sort((a, b) => a.key.localeCompare(b.key)),
    comparisonSeries: {
      models: [...modelSeriesMap.entries()].map(([name, buckets]) => ({
        name,
        points: [...buckets.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => a.key.localeCompare(b.key)),
      })).sort((a, b) => b.points.reduce((sum, point) => sum + point.value, 0) - a.points.reduce((sum, point) => sum + point.value, 0)),
      llm: [...llmSeriesMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
      favorites: [...favoritesSeriesMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
    },
    models,
    workflows,
    tags,
    llm,
  });
});

export default router;
