import express from 'express';
import path from 'path';
import fs from 'fs';
import { authenticate, requireAdmin } from '../middleware/auth';
import { imagesDir, thumbnailsDir, generateThumbnail } from '../services/image';
import { analyzeWorkflow } from '../services/workflow-import';

const router = express.Router();

const getRouteParam = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
};

const canAccessUserFiles = (req: express.Request, userId: string) => {
  const user = (req as any).user;
  return user?.id === userId || user?.isAdmin === 1;
};

const sendFileIfInside = (res: express.Response, baseDir: string, filePath: string) => {
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(filePath);

  if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
    return res.status(400).send('Invalid path');
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).send('Not found');
  }

  return res.sendFile(resolvedPath);
};

const getWorkflowsDir = () => {
  const backendDir = process.cwd().endsWith('backend') ? process.cwd() : path.join(process.cwd(), 'backend');
  return path.resolve(backendDir, 'workflows');
};

const getSafeWorkflowFilename = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const filename = path.basename(value.trim()).replace(/[^a-zA-Z0-9._-]+/g, '_');
  if (!filename || filename.endsWith('.config.json')) return null;
  return filename.endsWith('.json') ? filename : `${filename}.json`;
};

const detectWorkflowNodeMapping = (workflow: Record<string, any>) => {
  const entries = Object.entries(workflow);
  const findId = (types: string[]) => entries.find(([, node]) => types.includes(node?.class_type))?.[0];
  const latentNode = entries.find(([, node]) => (
    /latent/i.test(String(node?.class_type || ''))
    && node?.inputs
    && ('width' in node.inputs || 'width_override' in node.inputs)
    && ('height' in node.inputs || 'height_override' in node.inputs)
  ));
  const textNodes = entries.filter(([, node]) => node?.class_type === 'CLIPTextEncode');
  const negativeNode = textNodes.find(([, node]) => /negative|low quality|bad quality/i.test(String(node?.inputs?.text || '')));
  const positiveNode = textNodes.find(([id]) => id !== negativeNode?.[0]);

  return {
    checkpoint: findId(['CheckpointLoaderSimple']),
    diffusionModel: findId(['UNETLoader', 'UNETLoaderGGUF']),
    positive: positiveNode?.[0] || textNodes[0]?.[0],
    negative: negativeNode?.[0] || textNodes[1]?.[0],
    ksampler: findId(['KSampler', 'KSamplerAdvanced']),
    latent: latentNode?.[0],
    save: findId(['SaveImage'])
  };
};

const detectWorkflowGenerationDefaults = (workflow: Record<string, any>, mapping: Record<string, string | undefined>) => {
  const latentInputs = mapping.latent ? workflow[mapping.latent]?.inputs : undefined;
  const samplerInputs = mapping.ksampler ? workflow[mapping.ksampler]?.inputs : undefined;
  const defaults: Record<string, number | string> = {};
  const width = latentInputs?.width ?? latentInputs?.width_override;
  const height = latentInputs?.height ?? latentInputs?.height_override;
  if (typeof width === 'number') defaults.width = width;
  if (typeof height === 'number') defaults.height = height;
  if (typeof samplerInputs?.steps === 'number') defaults.steps = samplerInputs.steps;
  if (typeof samplerInputs?.cfg === 'number') defaults.cfg = samplerInputs.cfg;
  if (typeof samplerInputs?.sampler_name === 'string') defaults.sampler = samplerInputs.sampler_name;
  if (typeof samplerInputs?.scheduler === 'string') defaults.scheduler = samplerInputs.scheduler;
  return defaults;
};

const readWorkflowBundle = (filename: string) => {
  const workflowsDir = getWorkflowsDir();
  const workflowPath = path.resolve(workflowsDir, filename);
  if (!workflowPath.startsWith(workflowsDir + path.sep) || !fs.existsSync(workflowPath)) return null;
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8')) as Record<string, any>;
  const configPath = workflowPath.replace(/\.json$/, '.config.json');
  let configuredMapping: Record<string, string> = {};
  if (fs.existsSync(configPath)) {
    try {
      configuredMapping = JSON.parse(fs.readFileSync(configPath, 'utf8'))?.nodeMapping || {};
    } catch {
      configuredMapping = {};
    }
  }
  return { workflowsDir, workflowPath, configPath, workflow, configuredMapping };
};

// Robust thumbnail serving with on-the-fly generation
router.get('/thumbnails/:userId/:filename', authenticate, async (req, res) => {
  const userId = getRouteParam(req.params.userId);
  const filename = getRouteParam(req.params.filename);
  if (!canAccessUserFiles(req, userId)) return res.status(403).send('Forbidden');

  const userThumbsDir = path.join(thumbnailsDir, userId);
  const thumbPath = path.join(userThumbsDir, filename);
  
  if (fs.existsSync(thumbPath)) {
    return sendFileIfInside(res, userThumbsDir, thumbPath);
  }
  
  try {
    const originalName = filename.replace('_thumb.webp', '.webp');
    const userImagesDir = path.join(imagesDir, userId);
    const originalPath = path.join(userImagesDir, originalName);
    
    if (fs.existsSync(originalPath)) {
      console.log(`[Thumbnails] Generating on-the-fly: ${filename} for user ${userId}`);
      await generateThumbnail(originalPath, thumbPath);
      return sendFileIfInside(res, userThumbsDir, thumbPath);
    }
  } catch (err: any) { 
    console.error('[Thumbnails] On-the-fly generation failed:', err.message); 
  }
  res.status(404).send('Not found');
});

// Legacy non-user-specific thumbnail route
router.get('/thumbnails/:filename', authenticate, async (req, res) => {
  const filename = getRouteParam(req.params.filename);
  const legacyThumbsDir = path.join(imagesDir, 'thumbnails');
  const thumbPath = path.join(legacyThumbsDir, filename);

  if (fs.existsSync(thumbPath)) {
    return sendFileIfInside(res, legacyThumbsDir, thumbPath);
  }
  
  try {
    const originalName = filename.replace('_thumb.webp', '.webp');
    const originalPath = path.join(imagesDir, originalName);
    if (fs.existsSync(originalPath)) {
      await generateThumbnail(originalPath, thumbPath);
      return sendFileIfInside(res, legacyThumbsDir, thumbPath);
    }
  } catch (err: any) { 
    console.error('[Thumbnails Legacy] On-the-fly generation failed:', err.message); 
  }
  res.status(404).send('Not found');
});

router.get('/workflows', authenticate, (req, res) => {
  const workflowsDir = getWorkflowsDir();
  if (!fs.existsSync(workflowsDir)) return res.json([]);
  const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.json') && !f.endsWith('.config.json'));
  res.json(files);
});

router.post('/workflows/analyze', requireAdmin, (req, res) => {
  try {
    return res.json({ success: true, analysis: analyzeWorkflow(req.body?.workflow) });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Workflow invalide'
    });
  }
});

router.post('/workflows', requireAdmin, (req, res) => {
  const filename = getSafeWorkflowFilename(req.body?.filename);
  const workflow = req.body?.workflow;
  const overwrite = req.body?.overwrite === true;

  if (!filename) return res.status(400).json({ error: 'Nom de workflow invalide' });
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return res.status(400).json({ error: 'Workflow JSON invalide' });
  }

  const nodes = Object.values(workflow) as Array<Record<string, unknown>>;
  if (nodes.length === 0 || !nodes.some(node => typeof node?.class_type === 'string')) {
    return res.status(400).json({ error: 'Ce fichier ne semble pas être un workflow exporté au format API ComfyUI' });
  }

  const workflowsDir = getWorkflowsDir();
  fs.mkdirSync(workflowsDir, { recursive: true });
  const workflowPath = path.join(workflowsDir, filename);
  if (fs.existsSync(workflowPath) && !overwrite) {
    return res.status(409).json({ error: 'Un workflow portant ce nom existe déjà' });
  }

  if (fs.existsSync(workflowPath)) fs.copyFileSync(workflowPath, `${workflowPath}.backup`);
  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2), 'utf8');

  let analyzedMapping: Record<string, string | undefined> = {};
  try {
    analyzedMapping = { ...analyzeWorkflow(workflow).nodeMapping };
  } catch {
    // Keep the permissive importer compatible with custom ComfyUI nodes.
  }
  const nodeMapping = { ...detectWorkflowNodeMapping(workflow), ...analyzedMapping };
  const generationDefaults = detectWorkflowGenerationDefaults(workflow, nodeMapping);
  const configPath = workflowPath.replace(/\.json$/, '.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ nodeMapping }, null, 2), 'utf8');

  return res.status(fs.existsSync(`${workflowPath}.backup`) ? 200 : 201).json({
    success: true,
    filename,
    nodeMapping,
    generationDefaults
  });
});

router.get('/workflows/:filename/mapping', authenticate, (req, res) => {
  const filename = getSafeWorkflowFilename(getRouteParam(req.params.filename));
  if (!filename) return res.status(400).json({ error: 'Nom de workflow invalide' });
  const bundle = readWorkflowBundle(filename);
  if (!bundle) return res.status(404).json({ error: 'Workflow introuvable' });

  const detectedMapping = detectWorkflowNodeMapping(bundle.workflow);
  const nodeMapping = { ...detectedMapping, ...bundle.configuredMapping };
  const generationDefaults = detectWorkflowGenerationDefaults(bundle.workflow, nodeMapping);
  const nodes = Object.entries(bundle.workflow).map(([id, node]) => ({
    id,
    classType: node?.class_type || 'Unknown',
    title: node?._meta?.title || node?.class_type || id,
    inputs: Object.keys(node?.inputs || {})
  }));
  const samplerCount = nodes.filter(node => ['KSampler', 'KSamplerAdvanced', 'KSampler (Efficient)'].includes(node.classType)).length;

  return res.json({ filename, nodeMapping, detectedMapping, generationDefaults, nodes, samplerCount });
});

router.put('/workflows/:filename/mapping', requireAdmin, (req, res) => {
  const filename = getSafeWorkflowFilename(getRouteParam(req.params.filename));
  if (!filename) return res.status(400).json({ error: 'Nom de workflow invalide' });
  const bundle = readWorkflowBundle(filename);
  if (!bundle) return res.status(404).json({ error: 'Workflow introuvable' });

  const allowedKeys = ['checkpoint', 'diffusionModel', 'positive', 'negative', 'ksampler', 'latent', 'save'];
  const submitted = req.body?.nodeMapping;
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) {
    return res.status(400).json({ error: 'Mapping invalide' });
  }

  const nodeMapping: Record<string, string> = {};
  for (const key of allowedKeys) {
    const nodeId = submitted[key];
    if (nodeId === '' || nodeId === undefined || nodeId === null) continue;
    if (typeof nodeId !== 'string' || !bundle.workflow[nodeId]) {
      return res.status(400).json({ error: `Nœud invalide pour ${key}` });
    }
    nodeMapping[key] = nodeId;
  }

  fs.writeFileSync(bundle.configPath, JSON.stringify({ nodeMapping }, null, 2), 'utf8');
  const generationDefaults = detectWorkflowGenerationDefaults(bundle.workflow, nodeMapping);
  return res.json({ success: true, filename, nodeMapping, generationDefaults });
});

router.delete('/workflows/:filename', requireAdmin, (req, res) => {
  const filename = getSafeWorkflowFilename(getRouteParam(req.params.filename));
  if (!filename) return res.status(400).json({ error: 'Nom de workflow invalide' });

  const workflowsDir = getWorkflowsDir();
  const workflowPath = path.resolve(workflowsDir, filename);
  if (!workflowPath.startsWith(workflowsDir + path.sep)) return res.status(400).json({ error: 'Chemin invalide' });
  if (!fs.existsSync(workflowPath)) return res.status(404).json({ error: 'Workflow introuvable' });

  fs.unlinkSync(workflowPath);
  const configPath = workflowPath.replace(/\.json$/, '.config.json');
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  return res.json({ success: true });
});

router.get('/:userId/:filename', authenticate, (req, res) => {
  const userId = getRouteParam(req.params.userId);
  const filename = getRouteParam(req.params.filename);
  if (!canAccessUserFiles(req, userId)) return res.status(403).send('Forbidden');

  const userImagesDir = path.join(imagesDir, userId);
  return sendFileIfInside(res, userImagesDir, path.join(userImagesDir, filename));
});

// Legacy non-user-specific image route, kept for old database rows.
router.get('/:filename', authenticate, (req, res) => {
  return sendFileIfInside(res, imagesDir, path.join(imagesDir, getRouteParam(req.params.filename)));
});

export default router;
