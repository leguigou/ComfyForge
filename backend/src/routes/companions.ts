import express from 'express';
import fs from 'fs';
import { authenticate } from '../middleware/auth';
import {
  CompanionAssetError,
  findCompanionAsset,
  storeCompanionAsset
} from '../services/companion-assets';

const router = express.Router();
const routeParam = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

router.get('/:id', authenticate, (req, res) => {
  try {
    const user = (req as any).user;
    const asset = findCompanionAsset(user.id, routeParam(req.params.id));
    if (!asset) return res.status(404).json({ error: 'Companion sprite not found' });
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    return res.send(fs.readFileSync(asset.path));
  } catch (error) {
    if (error instanceof CompanionAssetError) return res.status(error.statusCode).json({ error: error.message });
    return res.status(500).json({ error: 'Unable to read companion sprite' });
  }
});

router.post('/:id', authenticate, (req, res) => {
  try {
    const user = (req as any).user;
    const id = routeParam(req.params.id);
    const asset = storeCompanionAsset(user.id, id, req.body?.spriteDataUrl);
    return res.status(201).json({
      success: true,
      profile: {
        id,
        source: 'custom',
        spriteUrl: `/api/companions/${encodeURIComponent(id)}`,
        spriteMimeType: asset.mimeType,
        spriteBytes: asset.bytes
      }
    });
  } catch (error) {
    if (error instanceof CompanionAssetError) return res.status(error.statusCode).json({ error: error.message });
    return res.status(500).json({ error: 'Unable to store companion sprite' });
  }
});

export default router;
