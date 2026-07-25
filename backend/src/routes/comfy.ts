import express from 'express';
import axios from 'axios';
import { authenticate } from '../middleware/auth';
import { getTargetComfyUrl, parseComfyError } from '../services/comfy';
import { ServiceUrlError } from '../security/service-url';

const router = express.Router();

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
      axios.get(`${targetUrl}/models/checkpoints`, { timeout: 5000 }),
      axios.get(`${targetUrl}/models/diffusion_models`, { timeout: 5000 }),
      axios.get(`${targetUrl}/models/unet`, { timeout: 5000 })
    ]);

    let checkpoints = checkpointResponse.status === 'fulfilled' && Array.isArray(checkpointResponse.value.data)
      ? checkpointResponse.value.data
      : [];
    const diffusionDirectoryModels = diffusionResponse.status === 'fulfilled' && Array.isArray(diffusionResponse.value.data)
      ? diffusionResponse.value.data as string[]
      : [];
    const unetDirectoryModels = unetResponse.status === 'fulfilled' && Array.isArray(unetResponse.value.data)
      ? unetResponse.value.data as string[]
      : [];
    let diffusionModels = [...new Set([...diffusionDirectoryModels, ...unetDirectoryModels])];

    if (checkpointResponse.status === 'rejected' || diffusionModels.length === 0) {
      const infoResp = await axios.get(`${targetUrl}/object_info`, { timeout: 5000 });
      if (checkpointResponse.status === 'rejected') {
        checkpoints = infoResp.data["CheckpointLoaderSimple"]?.input?.required?.ckpt_name?.[0] || [];
      }
      if (diffusionModels.length === 0) {
        diffusionModels = infoResp.data["UNETLoader"]?.input?.required?.unet_name?.[0] || [];
      }
    }

    checkpoints.sort();
    diffusionModels.sort();
    res.json({ models: checkpoints, checkpoints, diffusionModels });
  } catch (error: any) {
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: 'Failed to fetch models from ComfyUI: ' + error.message }); 
  }
});

export default router;
