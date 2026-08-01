import fs from 'fs';
import path from 'path';
import axios from 'axios';
import db from './database';
import { GenerationParams, WorkflowNodeMapping } from '../types';
import { validateServiceUrl } from '../security/service-url';

export const getComfyWsUrl = (httpUrl: string) => {
  return httpUrl.replace(/^http/, 'ws') + '/ws';
};

interface ComfyUrlResult {
  url: string;
  source: 'Environment' | 'Database' | 'Default';
}

export const getEffectiveComfyUrl = (): ComfyUrlResult => {
  if (process.env.COMFY_URL) {
    return { url: process.env.COMFY_URL, source: 'Environment' };
  }
  try {
    const settings = db.prepare('SELECT data FROM settings WHERE id = 1').get() as { data: string } | undefined;
    if (settings) {
      const data: { comfyUrl?: string } = JSON.parse(settings.data);
      if (data.comfyUrl) return { url: data.comfyUrl, source: 'Database' };
    }
  } catch {
    // settings table might not exist yet
  }
  return { url: 'http://127.0.0.1:8188', source: 'Default' };
};

export const getTargetComfyUrl = (requestedUrl?: string) => {
  const configured = getEffectiveComfyUrl();
  const target = configured.source === 'Environment'
    ? configured.url
    : requestedUrl || configured.url;
  return validateServiceUrl(target, 'ComfyUI');
};

export const releaseComfyMemory = async (targetUrl: string) => {
  await axios.post(`${targetUrl}/free`, {
    unload_models: true,
    free_memory: true,
  }, { timeout: 30000 });
};

export const getWorkflow = (prompt: string, params?: Partial<GenerationParams>) => {
  const workflowFile = params?.workflowFile || 'workflow_lcm.json';
  const backendDir = process.cwd().endsWith('backend') ? process.cwd() : path.join(process.cwd(), 'backend');
  const workflowsDir = path.resolve(backendDir, 'workflows');
  const fullPath = path.resolve(workflowsDir, workflowFile);
  if (
    path.basename(workflowFile) !== workflowFile
    || !workflowFile.endsWith('.json')
    || !fullPath.startsWith(workflowsDir + path.sep)
  ) {
    throw new Error('Fichier workflow invalide');
  }
  const configPath = fullPath.replace(/\.json$/, '.config.json');
  
  if (!fs.existsSync(fullPath)) throw new Error(`Fichier workflow introuvable : ${workflowFile}`);
  
  const workflow: Record<string, any> = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const nodes: WorkflowNodeMapping = { checkpoint: "1", positive: "3", negative: "4", ksampler: "10", latent: "6", save: "99" };
  
  if (fs.existsSync(configPath)) {
    try {
      const config: { nodeMapping?: WorkflowNodeMapping } = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.nodeMapping) Object.assign(nodes, config.nodeMapping);
    } catch {
      console.warn(`[Workflow] Failed to parse config for ${workflowFile}`);
    }
  }

  if (params?.comfyModel) {
    if (params.comfyModelType === 'diffusion') {
      const diffusionNodeId = nodes.diffusionModel || Object.keys(workflow).find(nodeId => (
        ['UNETLoader', 'UNETLoaderGGUF'].includes(workflow[nodeId]?.class_type)
        && workflow[nodeId]?.inputs
      ));
      if (!diffusionNodeId || !workflow[diffusionNodeId]?.inputs) {
        throw new Error(`Le workflow ${workflowFile} ne contient pas de nœud Load Diffusion Model compatible`);
      }
      workflow[diffusionNodeId].inputs.unet_name = params.comfyModel;
    } else if (workflow[nodes.checkpoint!]?.inputs) {
      workflow[nodes.checkpoint!].inputs.ckpt_name = params.comfyModel;
    }
  }
  if (workflow[nodes.positive!]?.inputs) {
    workflow[nodes.positive!].inputs.text = prompt;
  }
  if (workflow[nodes.negative!]?.inputs && params?.negativePrompt) {
    workflow[nodes.negative!].inputs.text = params.negativePrompt;
  }
  
  const mappedSamplerId = nodes.ksampler;
  const samplerNodeIds = Object.keys(workflow).filter(nodeId => (
    ['KSampler', 'KSamplerAdvanced', 'KSampler (Efficient)'].includes(workflow[nodeId]?.class_type)
  ));
  if (mappedSamplerId && workflow[mappedSamplerId] && !samplerNodeIds.includes(mappedSamplerId)) samplerNodeIds.unshift(mappedSamplerId);
  const generatedSeed = params?.seed ?? Math.floor(Math.random() * 1000000000000000);
  samplerNodeIds.forEach((nodeId, index) => {
    const inputs = workflow[nodeId]?.inputs;
    if (!inputs) return;
    if ('noise_seed' in inputs) inputs.noise_seed = index === 0 ? generatedSeed : inputs.noise_seed;
    else inputs.seed = generatedSeed;
    if (params) {
      if (params.steps) inputs.steps = params.steps;
      if (params.cfg) inputs.cfg = params.cfg;
      if (params.sampler) inputs.sampler_name = params.sampler;
      if (params.scheduler) inputs.scheduler = params.scheduler;
    }
  });

  const latentNodeId = nodes.latent || Object.keys(workflow).find(nodeId => {
    const node = workflow[nodeId];
    return /latent/i.test(String(node?.class_type || ''))
      && node?.inputs
      && ('width' in node.inputs || 'width_override' in node.inputs)
      && ('height' in node.inputs || 'height_override' in node.inputs);
  });
  if (latentNodeId && workflow[latentNodeId]?.inputs && params) {
    const inputs = workflow[latentNodeId].inputs;
    if (params.width) {
      if ('width' in inputs) inputs.width = params.width;
      else if ('width_override' in inputs) inputs.width_override = params.width;
    }
    if (params.height) {
      if ('height' in inputs) inputs.height = params.height;
      else if ('height_override' in inputs) inputs.height_override = params.height;
    }
  }

  if (
    workflow[nodes.save!]?.inputs
    && (
      workflow[nodes.save!]?.class_type === 'SaveImage'
      || 'filename_prefix' in workflow[nodes.save!].inputs
    )
  ) {
    workflow[nodes.save!].inputs.filename_prefix = "ComfyForge";
  }
  return workflow;
};

export const parseComfyError = (error: unknown): string => {
  const err = error as Record<string, any>;
  if (err?.response?.data?.error?.message) {
    let msg = err.response.data.error.message;
    if (err.response.data.error.details) msg += ` (${err.response.data.error.details})`;
    return msg;
  }
  if (err?.response?.data?.node_errors) {
    const nodes = Object.keys(err.response.data.node_errors);
    const node = nodes[0];
    const nodeErr = err.response.data.node_errors[node].errors[0];
    return `Node ${node} (${err.response.data.node_errors[node].class_type}): ${nodeErr.message}${nodeErr.details ? ' - ' + nodeErr.details : ''}`;
  }
  if ((err?.message as string | undefined)?.includes('ECONNREFUSED')) return 'ComfyUI is unreachable. Please check settings.';
  if (err?.code === 'ETIMEDOUT' || (err?.message as string | undefined)?.includes('timeout')) return 'ComfyUI request timed out (possible GPU overload or hang).';
  return (err?.message as string) || 'Unknown server error';
};
