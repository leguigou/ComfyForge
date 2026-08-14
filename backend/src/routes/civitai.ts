import express from 'express';
import { authenticate } from '../middleware/auth';
import { resolveCivitaiVersion, searchCivitaiModels } from '../services/civitai';

const router = express.Router();

const apiError = (error: unknown) => {
  const candidate = error as { response?: { status?: number }; message?: string };
  if (candidate.response?.status === 404) return { status: 404, message: 'Version Civitai introuvable' };
  if (candidate.response?.status === 429) return { status: 503, message: 'Civitai est temporairement saturé. Réessayez dans un instant.' };
  return { status: 502, message: candidate.message || 'Impossible de joindre Civitai' };
};

router.post('/search', authenticate, async (req, res) => {
  const localFileName = typeof req.body?.localFileName === 'string' ? req.body.localFileName : '';
  const query = typeof req.body?.query === 'string' ? req.body.query : undefined;
  if (!localFileName.trim()) return res.status(400).json({ error: 'Le nom du modèle local est requis' });
  try {
    return res.json({ candidates: await searchCivitaiModels(localFileName, query) });
  } catch (error) {
    const failure = apiError(error);
    return res.status(failure.status).json({ error: failure.message });
  }
});

router.post('/resolve', authenticate, async (req, res) => {
  const raw = typeof req.body?.modelVersionId === 'string' || typeof req.body?.modelVersionId === 'number'
    ? String(req.body.modelVersionId)
    : '';
  const fromUrl = raw.match(/[?&]modelVersionId=(\d+)/i)?.[1];
  const modelVersionId = Number(fromUrl || raw.match(/^\d+$/)?.[0]);
  const localFileName = typeof req.body?.localFileName === 'string' ? req.body.localFileName : '';
  if (!Number.isSafeInteger(modelVersionId) || modelVersionId <= 0) {
    return res.status(400).json({ error: 'URL ou identifiant de version Civitai invalide' });
  }
  try {
    return res.json({ candidate: await resolveCivitaiVersion(modelVersionId, localFileName) });
  } catch (error) {
    const failure = apiError(error);
    return res.status(failure.status).json({ error: failure.message });
  }
});

export default router;
