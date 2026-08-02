import express from 'express';
import axios from 'axios';
import { authenticate } from '../middleware/auth';
import { getTargetComfyUrl, parseComfyError, releaseComfyMemory } from '../services/comfy';
import { ServiceUrlError } from '../security/service-url';

const router = express.Router();

interface ComfyModelFile {
  name: string;
  size?: number;
}

interface ModelFileDetails {
  name: string;
  sizeBytes?: number;
  sizeGb?: number;
}

const fetchModelFolder = async (targetUrl: string, folder: string): Promise<ComfyModelFile[]> => {
  try {
    const response = await axios.get(`${targetUrl}/api/experiment/models/${folder}`, { timeout: 5000 });
    if (!Array.isArray(response.data)) throw new Error('Invalid experimental model response');
    return response.data
      .filter((model): model is { name: string; size?: number } => typeof model?.name === 'string')
      .map(model => ({
        name: model.name,
        ...(Number.isFinite(model.size) && Number(model.size) >= 0 ? { size: Number(model.size) } : {})
      }));
  } catch {
    const response = await axios.get(`${targetUrl}/models/${folder}`, { timeout: 5000 });
    if (!Array.isArray(response.data)) throw new Error('Invalid legacy model response');
    return response.data
      .filter((model): model is string => typeof model === 'string')
      .map(name => ({ name }));
  }
};

const mergeModelFiles = (...groups: ComfyModelFile[][]): ComfyModelFile[] => {
  const models = new Map<string, ComfyModelFile>();
  groups.flat().forEach(model => {
    const existing = models.get(model.name);
    if (!existing || (existing.size === undefined && model.size !== undefined)) models.set(model.name, model);
  });
  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
};

const toModelDetails = (models: ComfyModelFile[]): ModelFileDetails[] => models.map(model => ({
  name: model.name,
  ...(model.size !== undefined ? {
    sizeBytes: model.size,
    sizeGb: Number((model.size / 1_000_000_000).toFixed(2))
  } : {})
}));

router.post('/free', authenticate, async (req, res) => {
  try {
    const targetUrl = getTargetComfyUrl(req.body.comfyUrl);
    await releaseComfyMemory(targetUrl);
    res.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ success: false, error: error.message });
    res.status(500).json({ success: false, error: 'Failed to release ComfyUI memory: ' + parseComfyError(error) });
  }
});

router.post('/check', authenticate, async (req, res) => {
  try {
    const targetUrl = getTargetComfyUrl(req.body.comfyUrl);
    const response = await axios.get(`${targetUrl}/system_stats`, { timeout: 3000 });
    res.json({ success: true, stats: response.data });
  } catch (error: any) {
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ success: false, error: error.message });
    res.status(500).json({ success: false, error: 'ComfyUI connection failed: ' + parseComfyError(error) }); 
  }
});

router.post('/models', authenticate, async (req, res) => {
  try {
    const targetUrl = getTargetComfyUrl(req.body.comfyUrl);
    const [checkpointResponse, diffusionResponse, unetResponse] = await Promise.allSettled([
      fetchModelFolder(targetUrl, 'checkpoints'),
      fetchModelFolder(targetUrl, 'diffusion_models'),
      fetchModelFolder(targetUrl, 'unet')
    ]);

    let checkpointFiles = checkpointResponse.status === 'fulfilled'
      ? checkpointResponse.value
      : [];
    const diffusionDirectoryModels = diffusionResponse.status === 'fulfilled'
      ? diffusionResponse.value
      : [];
    const unetDirectoryModels = unetResponse.status === 'fulfilled'
      ? unetResponse.value
      : [];
    let diffusionFiles = mergeModelFiles(diffusionDirectoryModels, unetDirectoryModels);

    if (checkpointResponse.status === 'rejected' || diffusionFiles.length === 0) {
      const infoResp = await axios.get(`${targetUrl}/object_info`, { timeout: 5000 });
      if (checkpointResponse.status === 'rejected') {
        const names = infoResp.data["CheckpointLoaderSimple"]?.input?.required?.ckpt_name?.[0] || [];
        checkpointFiles = Array.isArray(names)
          ? names.filter((name: unknown): name is string => typeof name === 'string').map(name => ({ name }))
          : [];
      }
      if (diffusionFiles.length === 0) {
        const names = infoResp.data["UNETLoader"]?.input?.required?.unet_name?.[0] || [];
        diffusionFiles = Array.isArray(names)
          ? names.filter((name: unknown): name is string => typeof name === 'string').map(name => ({ name }))
          : [];
      }
    }

    checkpointFiles = mergeModelFiles(checkpointFiles);
    diffusionFiles = mergeModelFiles(diffusionFiles);
    const checkpoints = checkpointFiles.map(model => model.name);
    const diffusionModels = diffusionFiles.map(model => model.name);
    res.json({
      models: checkpoints,
      checkpoints,
      diffusionModels,
      checkpointDetails: toModelDetails(checkpointFiles),
      diffusionModelDetails: toModelDetails(diffusionFiles)
    });
  } catch (error: any) {
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: 'Failed to fetch models from ComfyUI: ' + error.message }); 
  }
});

export default router;
