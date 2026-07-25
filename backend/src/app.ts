import express, { Request } from 'express';
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
import { configureProviderEncryption } from './services/llm-providers';

const corsOptions = (req: Request): CorsOptions => ({
  origin: isAllowedRequestOrigin(req),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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

  app.use((req, res, next) => {
    if (!isAllowedRequestOrigin(req)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    next();
  });
  app.use(cors((req, callback) => callback(null, corsOptions(req))));
  app.use(apiRateLimiter);
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser(authSecret));

  const apiRouter = express.Router();
  apiRouter.use('/auth', authRoutes);
  apiRouter.use('/history', historyRoutes);
  apiRouter.use('/generate', generationRoutes);
  apiRouter.use('/settings', settingsRoutes);
  apiRouter.use('/users', userRoutes);
  apiRouter.use('/comfy', comfyRoutes);
  apiRouter.use('/llm', llmRoutes);
  apiRouter.use('/gallery', galleryRoutes);
  apiRouter.use('/updates', updateRoutes);
  apiRouter.use('/image-files', miscRoutes);
  apiRouter.use('/', miscRoutes);

  app.use('/api', apiRouter);
  app.use('/', apiRouter);

  return app;
};
