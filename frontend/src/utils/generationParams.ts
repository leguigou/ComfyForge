import type { GenParameters, NodeMapping } from '../types';

export type GenerationRequestParams = {
  comfyModel: string;
  comfyModelType: 'checkpoint' | 'diffusion';
  comfyUrl: string;
  workflowFile: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler?: string;
  scheduler?: string;
  negativePrompt: string;
  nodeMapping: NodeMapping;
  seed: number;
};

/** Keep multi-megabyte settings assets out of generation requests. */
export const toGenerationRequestParams = (
  params: GenParameters,
  overrides: Partial<GenerationRequestParams> = {}
): GenerationRequestParams => ({
  comfyModel: params.comfyModel,
  comfyModelType: params.comfyModelType,
  comfyUrl: params.comfyUrl,
  workflowFile: params.workflowFile,
  width: params.width,
  height: params.height,
  steps: params.steps,
  cfg: params.cfg,
  sampler: params.sampler,
  scheduler: params.scheduler,
  negativePrompt: params.negativePrompt,
  nodeMapping: params.nodeMapping,
  seed: params.seedMode === 'fixed' && params.forcedSeed
    ? Number.parseInt(params.forcedSeed, 10)
    : -1,
  ...overrides
});
