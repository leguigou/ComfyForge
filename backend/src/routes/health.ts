import express from 'express';
import axios from 'axios';
import db, { DATABASE_SCHEMA_VERSION } from '../services/database';
import { APP_VERSION } from '../config/app-version';
import { getTargetComfyUrl } from '../services/comfy';

const router = express.Router();

router.get('/', async (req, res) => {
  const startedAt = Date.now();
  const includeDependencies = req.query.dependencies !== '0';

  try {
    db.prepare('SELECT 1').get();
    const schemaVersion = db.pragma('user_version', { simple: true }) as number;
    const queue = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing
      FROM queue
    `).get() as { total: number; pending: number | null; processing: number | null };

    let comfy: { status: 'available' | 'unavailable' | 'not_checked'; latencyMs?: number } = {
      status: 'not_checked'
    };

    if (includeDependencies) {
      const dependencyStartedAt = Date.now();
      try {
        const targetUrl = getTargetComfyUrl();
        await axios.get(`${targetUrl}/system_stats`, { timeout: 1500 });
        comfy = { status: 'available', latencyMs: Date.now() - dependencyStartedAt };
      } catch {
        comfy = { status: 'unavailable', latencyMs: Date.now() - dependencyStartedAt };
      }
    }

    const status = comfy.status === 'unavailable' ? 'degraded' : 'healthy';
    res.status(200).json({
      status,
      version: APP_VERSION,
      revision: process.env.APP_REVISION || null,
      uptimeSeconds: Math.floor(process.uptime()),
      checkedAt: Date.now(),
      responseTimeMs: Date.now() - startedAt,
      database: {
        status: 'available',
        schemaVersion,
        expectedSchemaVersion: DATABASE_SCHEMA_VERSION
      },
      queue: {
        total: queue.total,
        pending: queue.pending || 0,
        processing: queue.processing || 0
      },
      comfy
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      version: APP_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      checkedAt: Date.now(),
      responseTimeMs: Date.now() - startedAt,
      database: { status: 'unavailable' },
      error: error instanceof Error ? error.message : 'Health check failed'
    });
  }
});

export default router;
