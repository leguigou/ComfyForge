import { describe, expect, it } from 'vitest';
import { analyzeWorkflow, sanitizeWorkflowFilename } from './workflow-import';

const workflow = {
  '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
  '3': { class_type: 'CLIPTextEncode', _meta: { title: 'APP_PROMPT' }, inputs: { text: 'hello', clip: ['1', 1] } },
  '4': { class_type: 'CLIPTextEncode', _meta: { title: 'APP_NEGATIVE_PROMPT' }, inputs: { text: '', clip: ['1', 1] } },
  '6': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
  '10': { class_type: 'KSampler', inputs: { seed: 1, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'normal' } },
  '99': { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['10', 0] } },
};

describe('workflow import', () => {
  it('detects mapped nodes from an API workflow', () => {
    const result = analyzeWorkflow(workflow);
    expect(result.nodeMapping).toEqual({
      checkpoint: '1',
      positive: '3',
      negative: '4',
      ksampler: '10',
      latent: '6',
      save: '99',
    });
  });

  it('rejects UI-format workflows', () => {
    expect(() => analyzeWorkflow({ nodes: [], links: [] })).toThrow(/format API/);
  });

  it('rejects path traversal and config filenames', () => {
    expect(() => sanitizeWorkflowFilename('../workflow.json')).toThrow();
    expect(() => sanitizeWorkflowFilename('workflow.config.json')).toThrow();
  });

  it('accepts a safe JSON filename', () => {
    expect(sanitizeWorkflowFilename('portrait-zimage_v2.json')).toBe('portrait-zimage_v2.json');
  });
});
