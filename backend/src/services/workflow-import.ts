import path from 'path';
import { WorkflowNodeMapping } from '../types';

export interface WorkflowAnalysis {
  format: 'api';
  nodeMapping: WorkflowNodeMapping;
  detected: Record<string, Array<{ id: string; classType: string; title?: string }>>;
  warnings: string[];
}

const SAFE_WORKFLOW_NAME = /^[a-zA-Z0-9._-]+\.json$/;

export const sanitizeWorkflowFilename = (filename: string): string => {
  const trimmed = filename.trim();
  const normalized = path.basename(trimmed);
  if (trimmed !== normalized) {
    throw new Error('Nom de fichier workflow invalide');
  }
  if (!SAFE_WORKFLOW_NAME.test(normalized) || normalized.endsWith('.config.json')) {
    throw new Error('Nom de fichier workflow invalide');
  }
  return normalized;
};

const getTitle = (node: any): string => {
  return String(node?._meta?.title || node?.title || '').trim();
};

const hasInput = (node: any, input: string) => {
  return Boolean(node && typeof node === 'object' && node.inputs && Object.prototype.hasOwnProperty.call(node.inputs, input));
};

const isApiWorkflow = (workflow: unknown): workflow is Record<string, any> => {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) return false;
  const nodes = Object.values(workflow as Record<string, any>);
  return nodes.length > 0 && nodes.every(node => node && typeof node === 'object' && typeof node.class_type === 'string' && node.inputs && typeof node.inputs === 'object');
};

const chooseNode = (
  entries: Array<[string, any]>,
  explicitTitles: string[],
  predicate: (node: any) => boolean,
): string | undefined => {
  const byTitle = entries.find(([, node]) => explicitTitles.includes(getTitle(node).toUpperCase()));
  if (byTitle) return byTitle[0];
  return entries.find(([, node]) => predicate(node))?.[0];
};

export const analyzeWorkflow = (workflow: unknown): WorkflowAnalysis => {
  if (!isApiWorkflow(workflow)) {
    throw new Error("Le fichier n'est pas un workflow ComfyUI au format API. Dans ComfyUI, utilise 'Save (API Format)'.");
  }

  const entries = Object.entries(workflow);
  const detected: WorkflowAnalysis['detected'] = {};
  for (const [id, node] of entries) {
    const key = node.class_type;
    detected[key] ||= [];
    detected[key].push({ id, classType: node.class_type, title: getTitle(node) || undefined });
  }

  const positive = chooseNode(entries, ['APP_PROMPT', 'APP_POSITIVE', 'APP_POSITIVE_PROMPT'], node =>
    /TextEncode|Prompt/i.test(node.class_type) && hasInput(node, 'text') && !/negative/i.test(getTitle(node)),
  );
  const negative = chooseNode(entries, ['APP_NEGATIVE', 'APP_NEGATIVE_PROMPT'], node =>
    /TextEncode|Prompt/i.test(node.class_type) && hasInput(node, 'text') && /negative/i.test(getTitle(node)),
  );
  const ksampler = chooseNode(entries, ['APP_KSAMPLER', 'APP_SAMPLER', 'APP_SEED'], node =>
    /KSampler|SamplerCustom/i.test(node.class_type) && (hasInput(node, 'seed') || hasInput(node, 'noise_seed')),
  );
  const latent = chooseNode(entries, ['APP_SIZE', 'APP_LATENT', 'APP_RESOLUTION'], node =>
    hasInput(node, 'width') && hasInput(node, 'height'),
  );
  const checkpoint = chooseNode(entries, ['APP_CHECKPOINT', 'APP_MODEL'], node =>
    hasInput(node, 'ckpt_name') || /CheckpointLoader/i.test(node.class_type),
  );
  const save = chooseNode(entries, ['APP_SAVE', 'APP_OUTPUT'], node =>
    /SaveImage/i.test(node.class_type) && hasInput(node, 'filename_prefix'),
  );

  const textNodes = entries.filter(([, node]) => /TextEncode|Prompt/i.test(node.class_type) && hasInput(node, 'text'));
  const resolvedPositive = positive || textNodes[0]?.[0];
  const resolvedNegative = negative || textNodes.find(([id]) => id !== resolvedPositive)?.[0];

  const nodeMapping: WorkflowNodeMapping = {
    checkpoint,
    positive: resolvedPositive,
    negative: resolvedNegative,
    ksampler,
    latent,
    save,
  };

  const warnings: string[] = [];
  if (!nodeMapping.positive) warnings.push('Aucun nœud de prompt positif détecté.');
  if (!nodeMapping.ksampler) warnings.push('Aucun KSampler avec seed détecté.');
  if (!nodeMapping.save) warnings.push('Aucun nœud SaveImage détecté.');
  if (!nodeMapping.negative) warnings.push('Aucun prompt négatif détecté, ce paramètre sera ignoré.');
  if (!nodeMapping.latent) warnings.push('Aucun nœud largeur/hauteur détecté, la résolution du workflow sera conservée.');
  if (!nodeMapping.checkpoint) warnings.push('Aucun chargeur de checkpoint détecté, le modèle du workflow sera conservé.');

  if (!nodeMapping.positive || !nodeMapping.ksampler || !nodeMapping.save) {
    throw new Error(`Workflow incomplet : ${warnings.join(' ')}`);
  }

  return { format: 'api', nodeMapping, detected, warnings };
};
