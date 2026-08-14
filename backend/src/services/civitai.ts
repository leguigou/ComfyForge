import axios from 'axios';
import path from 'node:path';
import { APP_VERSION } from '../config/app-version';

const CIVITAI_API = 'https://civitai.com/api/v1';

interface CivitaiFile {
  name?: unknown;
  hashes?: { AutoV2?: unknown; SHA256?: unknown };
  primary?: unknown;
}

interface CivitaiVersion {
  id?: unknown;
  modelId?: unknown;
  name?: unknown;
  baseModel?: unknown;
  air?: unknown;
  files?: CivitaiFile[];
  model?: { name?: unknown; type?: unknown };
}

interface CivitaiModel {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  modelVersions?: CivitaiVersion[];
}

export interface CivitaiModelCandidate {
  modelId: number;
  modelVersionId: number;
  modelName: string;
  versionName: string;
  fileName: string;
  baseModel?: string;
  modelType?: string;
  air?: string;
  autoV2?: string;
  sha256?: string;
  score: number;
}

export const normalizeModelName = (value: string) => path.basename(value.replace(/\\/g, '/'))
  .replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

const stringValue = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const numberValue = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;

const similarityScore = (localFileName: string, modelName: string, versionName: string, fileName: string) => {
  const local = normalizeModelName(localFileName);
  const file = normalizeModelName(fileName);
  const combined = normalizeModelName(`${modelName} ${versionName}`);
  const model = normalizeModelName(modelName);
  if (!local) return 0;
  if (local === file) return 140;
  if (local === combined) return 130;
  if (combined.includes(local) || local.includes(combined)) return 105;
  if (file.includes(local) || local.includes(file)) return 100;
  if (local.startsWith(model) || model.startsWith(local)) return 80;

  const localPairs = new Set(Array.from({ length: Math.max(0, local.length - 1) }, (_, index) => local.slice(index, index + 2)));
  const remote = `${file}${combined}`;
  const matches = [...localPairs].filter(pair => remote.includes(pair)).length;
  return localPairs.size ? Math.round((matches / localPairs.size) * 70) : 0;
};

const versionToCandidates = (
  version: CivitaiVersion,
  fallbackModel?: Pick<CivitaiModel, 'id' | 'name' | 'type'>,
  localFileName = '',
): CivitaiModelCandidate[] => {
  const modelId = numberValue(version.modelId) || numberValue(fallbackModel?.id);
  const modelVersionId = numberValue(version.id);
  const modelName = stringValue(version.model?.name) || stringValue(fallbackModel?.name);
  const versionName = stringValue(version.name);
  if (!modelId || !modelVersionId || !modelName || !versionName) return [];

  return (Array.isArray(version.files) ? version.files : []).flatMap(file => {
    const fileName = stringValue(file.name);
    if (!fileName) return [];
    return [{
      modelId,
      modelVersionId,
      modelName,
      versionName,
      fileName,
      ...(stringValue(version.baseModel) ? { baseModel: stringValue(version.baseModel) } : {}),
      ...(stringValue(version.model?.type) || stringValue(fallbackModel?.type)
        ? { modelType: stringValue(version.model?.type) || stringValue(fallbackModel?.type) }
        : {}),
      ...(stringValue(version.air) ? { air: stringValue(version.air) } : {}),
      ...(stringValue(file.hashes?.AutoV2) ? { autoV2: stringValue(file.hashes?.AutoV2)?.toUpperCase() } : {}),
      ...(stringValue(file.hashes?.SHA256) ? { sha256: stringValue(file.hashes?.SHA256)?.toUpperCase() } : {}),
      score: similarityScore(localFileName, modelName, versionName, fileName),
    }];
  });
};

export const searchCivitaiModels = async (localFileName: string, requestedQuery?: string) => {
  const cleanLocalName = localFileName.trim().slice(0, 300);
  if (!cleanLocalName) throw new Error('A local model name is required');
  const query = (requestedQuery?.trim() || path.basename(cleanLocalName.replace(/\\/g, '/')).replace(/\.[^.]+$/, ''))
    .replace(/[_-]+/g, ' ')
    .trim()
    .slice(0, 120);

  const response = await axios.get(`${CIVITAI_API}/models`, {
    params: { query, limit: 20 },
    timeout: 15_000,
    headers: { Accept: 'application/json', 'User-Agent': `ComfyForge/${APP_VERSION}` },
  });
  const models = Array.isArray(response.data?.items) ? response.data.items as CivitaiModel[] : [];
  return models
    .flatMap(model => (Array.isArray(model.modelVersions) ? model.modelVersions : [])
      .flatMap(version => versionToCandidates(version, model, cleanLocalName)))
    .sort((a, b) => b.score - a.score || b.modelVersionId - a.modelVersionId)
    .slice(0, 30);
};

export const resolveCivitaiVersion = async (modelVersionId: number, localFileName = '') => {
  const response = await axios.get(`${CIVITAI_API}/model-versions/${modelVersionId}`, {
    timeout: 15_000,
    headers: { Accept: 'application/json', 'User-Agent': `ComfyForge/${APP_VERSION}` },
  });
  const candidates = versionToCandidates(response.data as CivitaiVersion, undefined, localFileName);
  if (!candidates.length) throw new Error('This Civitai version has no downloadable model file');
  return candidates.sort((a, b) => b.score - a.score)[0];
};
