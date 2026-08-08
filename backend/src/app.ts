import express, { ErrorRequestHandler, Request } from 'express';
import cors, { CorsOptions } from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { initDatabase } from './services/database';
import { isAllowedRequestOrigin } from './security/origin';
import authRoutes from './routes/auth';
import historyRoutes from './routes/history';
import generationRoutes from './routes/generation';
import settingsRoutes from './routes/settings';
import userRoutes from './routes/users';
import comfyRoutes from './routes/comfy';
import llmRoutes from './routes/llm';
import galleryRoutes from './routes/gallery';
import miscRoutes from './routes/misc';
import updateRoutes from './routes/updates';
import adminLogRoutes from './routes/admin-logs';
import statisticsRoutes from './routes/statistics';
import comparisonRoutes from './routes/comparisons';
import healthRoutes from './routes/health';
import adminQueueRoutes from './routes/admin-queue';
import companionRoutes from './routes/companions';
import { configureProviderEncryption } from './services/llm-providers';
import { startAuditLogRetention } from './services/audit-log';
import { compressJsonResponses } from './middleware/response-compression';
import { requestContext } from './middleware/request-context';
import { createCsrfProtection } from './security/csrf';

const corsOptions = (req: Request): CorsOptions => ({
  origin: isAllowedRequestOrigin(req),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token'],
  exposedHeaders: ['X-Request-ID', 'X-ComfyForge-Settings-Source', 'X-CSRF-Token'],
});

const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' },
});

export const createApp = (authSecret: string) => {
  const app = express();

  app.set('trust proxy', 1);
  configureProviderEncryption(authSecret);
  initDatabase();
  startAuditLogRetention();
  app.use(requestContext);

  app.use((req, res, next) => {
    if (!isAllowedRequestOrigin(req)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    next();
  });
  app.use(cors((req, callback) => callback(null, corsOptions(req))));
  app.use(apiRateLimiter);
  const largeJsonParser = express.json({ limit: '160mb' });
  const legacyGenerationJsonParser = express.json({ limit: '32mb' });
  const companionAssetJsonParser = express.json({ limit: '8mb' });
  app.use((req, res, next) => {
    const largeBodyRoute = [
      '/api/settings',
      '/settings',
      '/api/llm/analyze-image',
      '/llm/analyze-image'
    ].includes(req.path);
    return largeBodyRoute ? largeJsonParser(req, res, next) : next();
  });
  app.use((req, res, next) => {
    const companionAssetRoute = req.path.startsWith('/api/companions/')
      || req.path.startsWith('/companions/');
    return companionAssetRoute ? companionAssetJsonParser(req, res, next) : next();
  });
  app.use((req, res, next) => {
    const legacyGenerationRoute = [
      '/api/generate/',
      '/generate/'
    ].some(prefix => req.path.startsWith(prefix)) || [
      '/api/llm/enhance-prompt',
      '/llm/enhance-prompt'
    ].includes(req.path);
    return legacyGenerationRoute ? legacyGenerationJsonParser(req, res, next) : next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser(authSecret));
  app.use(createCsrfProtection(authSecret));
  app.use(compressJsonResponses);

  const apiRouter = express.Router();
  apiRouter.use('/health', healthRoutes);
  apiRouter.use('/auth', authRoutes);
  apiRouter.use('/history', historyRoutes);
  apiRouter.use('/generate', generationRoutes);
  apiRouter.use('/settings', settingsRoutes);
  apiRouter.use('/users', userRoutes);
  apiRouter.use('/comfy', comfyRoutes);
  apiRouter.use('/llm', llmRoutes);
  apiRouter.use('/gallery', galleryRoutes);
  apiRouter.use('/updates', updateRoutes);
  apiRouter.use('/admin/logs', adminLogRoutes);
  apiRouter.use('/admin/queue', adminQueueRoutes);
  apiRouter.use('/companions', companionRoutes);
  apiRouter.use('/statistics', statisticsRoutes);
  apiRouter.use('/comparisons', comparisonRoutes);
  apiRouter.use('/image-files', miscRoutes);
  apiRouter.use('/', miscRoutes);

  app.use('/api', apiRouter);
  app.use('/', apiRouter);

  const handleApiError: ErrorRequestHandler = (error, _req, res, next) => {
    if (error?.type === 'entity.too.large' || error?.status === 413) {
      return res.status(413).json({
        code: 'PAYLOAD_TOO_LARGE',
        error: 'La requête est trop volumineuse. Rechargez l’application avant de réessayer.'
      });
    }
    return next(error);
  };
  app.use(handleApiError);

  return app;
};
