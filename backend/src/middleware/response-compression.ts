import type { NextFunction, Request, Response } from 'express';
import { brotliCompressSync, constants, gzipSync } from 'zlib';

const MIN_COMPRESSIBLE_BYTES = 2 * 1024;

export const compressJsonResponses = (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    if (req.method === 'HEAD' || res.headersSent) return originalJson(body);

    const acceptedEncoding = req.headers['accept-encoding'] || '';
    const supportsBrotli = /(?:^|,)\s*br\s*(?:,|$)/i.test(acceptedEncoding);
    const supportsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(acceptedEncoding);
    if (!supportsBrotli && !supportsGzip) return originalJson(body);

    const source = Buffer.from(JSON.stringify(body));
    if (source.length < MIN_COMPRESSIBLE_BYTES) return originalJson(body);

    const encoding = supportsBrotli ? 'br' : 'gzip';
    const compressed = supportsBrotli
      ? brotliCompressSync(source, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 4 }
        })
      : gzipSync(source, { level: 6 });

    res.vary('Accept-Encoding');
    res.type('application/json');
    res.setHeader('Content-Encoding', encoding);
    res.setHeader('Content-Length', compressed.length);
    return res.send(compressed);
  }) as Response['json'];

  next();
};
