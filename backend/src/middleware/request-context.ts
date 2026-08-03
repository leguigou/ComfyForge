import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export const requestContext = (req: Request, res: Response, next: NextFunction) => {
  const provided = req.header('x-request-id') || '';
  req.requestId = SAFE_REQUEST_ID.test(provided) ? provided : randomUUID();
  res.setHeader('X-Request-ID', req.requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'http_request',
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.user?.id || null
    }));
  });

  next();
};
