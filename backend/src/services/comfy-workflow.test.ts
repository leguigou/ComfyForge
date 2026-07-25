import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getComfyWsUrl, getWorkflow } from './comfy';

describe('getComfyWsUrl', () => {
  it('converts http to ws', () => {
    expect(getComfyWsUrl('http://127.0.0.1:8188')).toBe('ws://127.0.0.1:8188/ws');
  });

  it('converts https to wss', () => {
    expect(getComfyWsUrl('https://comfy.example.com').startsWith('wss://')).toBe(true);
  });

  it('appends /ws path', () => {
    expect(getComfyWsUrl('http://localhost:3000')).toBe('ws://localhost:3000/ws');
  });
});

describe('Workflow config file structure', () => {
  const workflowsDir = path.join(__dirname, '..', '..', 'workflows');
  let workflowFiles: string[];

  beforeAll(() => {
    if (fs.existsSync(workflowsDir)) {
      workflowFiles = fs.readdirSync(workflowsDir)
        .filter(f => f.endsWith('.json') && !f.includes('.config.'));
    }
  });

  it('has at least one workflow file', () => {
    expect(workflowFiles?.length).toBeGreaterThanOrEqual(1);
  });

  it('each workflow file is valid JSON', () => {
    for (const file of workflowFiles || []) {
      const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
      expect(() => JSON.parse(content)).not.toThrow();
    }
  });

  it('each workflow file has an optional .config.json with valid JSON', () => {
    for (const file of workflowFiles || []) {
      const configPath = path.join(workflowsDir, file.replace('.json', '.config.json'));
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        expect(() => JSON.parse(content)).not.toThrow();
      }
    }
  });
});

describe('ZIT API workflow mapping', () => {
  it('injects the UNET model, prompt, dimensions and advanced sampler inputs', () => {
    const workflowsDir = path.join(__dirname, '..', '..', 'workflows');
    const workflowFile = fs.readdirSync(workflowsDir).find(file => /^ZIT.*\.json$/i.test(file) && !file.endsWith('.config.json'));
    expect(workflowFile).toBeTruthy();
    const workflow = getWorkflow('A mapped ZIT prompt', {
      workflowFile: workflowFile!,
      comfyModel: 'zit-test-model.safetensors',
      comfyModelType: 'diffusion',
      width: 1024,
      height: 768,
      steps: 12,
      cfg: 1.5,
      sampler: 'heun',
      scheduler: 'karras',
      seed: 42
    });

    const nodes = Object.values(workflow) as Array<any>;
    const unet = nodes.find(node => node.class_type === 'UNETLoader');
    const prompt = nodes.find(node => node.class_type === 'CLIPTextEncode');
    const latent = nodes.find(node => node.class_type === 'EmptySD3LatentImage');
    const samplers = nodes.filter(node => node.class_type === 'KSamplerAdvanced');
    const save = nodes.find(node => node.class_type === 'SaveImage');

    expect(unet.inputs.unet_name).toBe('zit-test-model.safetensors');
    expect(prompt.inputs.text).toBe('A mapped ZIT prompt');
    expect(latent.inputs.width).toBe(1024);
    expect(latent.inputs.height).toBe(768);
    expect(samplers[0].inputs.noise_seed).toBe(42);
    expect(samplers.every(node => node.inputs.steps === 12)).toBe(true);
    expect(samplers.every(node => node.inputs.cfg === 1.5)).toBe(true);
    expect(samplers.every(node => node.inputs.sampler_name === 'heun')).toBe(true);
    expect(samplers.every(node => node.inputs.scheduler === 'karras')).toBe(true);
    expect(save.inputs.filename_prefix).toBe('ComfyForge');
  });
});
