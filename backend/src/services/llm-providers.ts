import crypto from 'crypto';
import axios from 'axios';
import { validateServiceUrl } from '../security/service-url';
import { writeAuditLog } from './audit-log';

export type ProviderType = 'openai' | 'anthropic' | 'google';

export interface ProviderPreset {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
}

export interface StoredProvider {
  id: string;
  userId: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  isActive: number;
  createdAt: number;
  updatedAt: number;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', name: 'OpenAI / ChatGPT', type: 'openai', baseUrl: 'https://api.openai.com', defaultModel: 'gpt-4.1-mini', requiresApiKey: true },
  { id: 'anthropic', name: 'Anthropic Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-5', requiresApiKey: true },
  { id: 'google', name: 'Google Gemini', type: 'google', baseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.5-flash', requiresApiKey: true },
  { id: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', requiresApiKey: true },
  { id: 'xai', name: 'xAI / Grok', type: 'openai', baseUrl: 'https://api.x.ai', defaultModel: 'grok-3-mini', requiresApiKey: true },
  { id: 'mistral', name: 'Mistral AI', type: 'openai', baseUrl: 'https://api.mistral.ai', defaultModel: 'mistral-small-latest', requiresApiKey: true },
  { id: 'groq', name: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai', defaultModel: 'llama-3.3-70b-versatile', requiresApiKey: true },
  { id: 'openrouter', name: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api', defaultModel: 'openai/gpt-4.1-mini', requiresApiKey: true },
  { id: 'together', name: 'Together AI', type: 'openai', baseUrl: 'https://api.together.xyz', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', requiresApiKey: true },
  { id: 'lmstudio', name: 'LM Studio (local)', type: 'openai', baseUrl: 'http://127.0.0.1:1234', defaultModel: '', requiresApiKey: false },
  { id: 'ollama', name: 'Ollama (local)', type: 'openai', baseUrl: 'http://127.0.0.1:11434', defaultModel: 'llama3:latest', requiresApiKey: false },
];

let encryptionKey: Buffer | null = null;

export const configureProviderEncryption = (secret: string) => {
  // Keep the historical namespace so upgrades can still decrypt existing API keys.
  encryptionKey = crypto.createHash('sha256').update(`comfyrealism:llm:${secret}`).digest();
};

export const encryptApiKey = (value: string) => {
  if (!encryptionKey) throw new Error('Provider encryption is not configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
};

export const decryptApiKey = (value: string | null) => {
  if (!value) return '';
  if (!encryptionKey) throw new Error('Provider encryption is not configured');
  const [version, iv, tag, encrypted] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Invalid encrypted provider key');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
};

export const resolveProviderUrl = (presetId: string | undefined, baseUrl: unknown) => {
  const preset = PROVIDER_PRESETS.find(item => item.id === presetId);
  if (preset && (typeof baseUrl !== 'string' || !baseUrl.trim() || baseUrl.trim().replace(/\/$/, '') === preset.baseUrl)) {
    return preset.baseUrl;
  }
  return validateServiceUrl(baseUrl, 'LLM');
};

const authHeaders = (provider: StoredProvider) => {
  const key = decryptApiKey(provider.apiKey);
  if (provider.type === 'anthropic') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  return key ? { Authorization: `Bearer ${key}` } : {};
};

export const listProviderModels = async (provider: StoredProvider) => {
  const baseUrl = provider.baseUrl.replace(/\/$/, '');
  if (provider.type === 'google') {
    const key = decryptApiKey(provider.apiKey);
    const response = await axios.get(`${baseUrl}/v1beta/models`, { params: { key }, timeout: 10000 });
    return (response.data.models || [])
      .filter((model: any) => model.supportedGenerationMethods?.includes('generateContent'))
      .map((model: any) => String(model.name).replace(/^models\//, ''));
  }
  const response = await axios.get(`${baseUrl}/v1/models`, { headers: authHeaders(provider), timeout: 10000 });
  return (response.data.data || []).map((model: any) => model.id);
};

export const completeWithProvider = async (provider: StoredProvider, prompt: string, systemMessage: string, temperature = 0.7) => {
  const baseUrl = provider.baseUrl.replace(/\/$/, '');
  const startedAt = Date.now();
  writeAuditLog({
    source: 'llm',
    direction: 'outbound',
    event: 'llm.request',
    message: `Requête envoyée à ${provider.name}`,
    status: 'sending',
    userId: provider.userId,
    details: { providerId: provider.id, type: provider.type, baseUrl, model: provider.model, prompt, systemMessage, temperature }
  });

  try {
    let content = '';
    let responseData: unknown;
    if (provider.type === 'anthropic') {
      const response = await axios.post(`${baseUrl}/v1/messages`, {
        model: provider.model, max_tokens: 2048, temperature,
        system: systemMessage, messages: [{ role: 'user', content: prompt }]
      }, { headers: { ...authHeaders(provider), 'content-type': 'application/json' }, timeout: 30000 });
      responseData = response.data;
      content = response.data.content?.map((part: any) => part.text || '').join('') || '';
    } else if (provider.type === 'google') {
      const key = decryptApiKey(provider.apiKey);
      const response = await axios.post(`${baseUrl}/v1beta/models/${encodeURIComponent(provider.model)}:generateContent`, {
        systemInstruction: { parts: [{ text: systemMessage }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, responseMimeType: 'application/json' }
      }, { params: { key }, timeout: 30000 });
      responseData = response.data;
      content = response.data.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('') || '';
    } else {
      const response = await axios.post(`${baseUrl}/v1/chat/completions`, {
        model: provider.model,
        messages: [{ role: 'system', content: systemMessage }, { role: 'user', content: prompt }],
        temperature
      }, { headers: authHeaders(provider), timeout: 30000 });
      responseData = response.data;
      content = response.data.choices?.[0]?.message?.content || '';
    }

    writeAuditLog({
      source: 'llm',
      direction: 'inbound',
      event: 'llm.response',
      message: `Réponse reçue de ${provider.name}`,
      status: 'completed',
      durationMs: Date.now() - startedAt,
      userId: provider.userId,
      details: { providerId: provider.id, model: provider.model, content, response: responseData }
    });
    return content;
  } catch (error: any) {
    writeAuditLog({
      level: 'error',
      source: 'llm',
      direction: 'inbound',
      event: 'llm.failed',
      message: error.response?.data?.error?.message || error.message || 'Erreur LLM',
      status: String(error.response?.status || 'failed'),
      durationMs: Date.now() - startedAt,
      userId: provider.userId,
      details: { providerId: provider.id, model: provider.model, response: error.response?.data }
    });
    throw error;
  }
};

export type LocalProviderEngine = 'ollama' | 'lmstudio';

export const detectLocalProviderEngine = (provider: Pick<StoredProvider, 'name' | 'baseUrl' | 'type'>): LocalProviderEngine | null => {
  if (provider.type !== 'openai') return null;
  const name = provider.name.toLowerCase();
  try {
    const url = new URL(provider.baseUrl);
    // The configured endpoint is more reliable than a provider name that may
    // have been kept after switching the local engine.
    if (url.port === '11434') return 'ollama';
    if (url.port === '1234') return 'lmstudio';
    if (name.includes('ollama')) return 'ollama';
    if (name.includes('lm studio') || name.includes('lmstudio')) return 'lmstudio';
  } catch {
    return null;
  }
  return null;
};

const nativeServiceOrigin = (provider: StoredProvider) => new URL(provider.baseUrl).origin;

export interface UnloadModelResult {
  engine: LocalProviderEngine;
  model: string;
  status: 'unloaded' | 'not_loaded';
  instances?: number;
}

export const unloadProviderModel = async (provider: StoredProvider, model: string): Promise<UnloadModelResult> => {
  const engine = detectLocalProviderEngine(provider);
  if (!engine) throw new Error('This provider does not expose a supported local memory API');
  const selectedModel = model.trim();
  if (!selectedModel) throw new Error('A model is required');
  const origin = nativeServiceOrigin(provider);

  if (engine === 'ollama') {
    await axios.post(`${origin}/api/generate`, {
      model: selectedModel,
      keep_alive: 0,
    }, { headers: authHeaders(provider), timeout: 30000 });
    return { engine, model: selectedModel, status: 'unloaded', instances: 1 };
  }

  const response = await axios.get(`${origin}/api/v1/models`, {
    headers: authHeaders(provider),
    timeout: 10000,
  });
  const models = Array.isArray(response.data?.models) ? response.data.models : [];
  const matchingInstances = models.flatMap((candidate: any) => {
    const instances = Array.isArray(candidate?.loaded_instances) ? candidate.loaded_instances : [];
    if (candidate?.key === selectedModel) return instances;
    return instances.filter((instance: any) => instance?.id === selectedModel);
  });
  const instanceIds = [...new Set(matchingInstances.map((instance: any) => String(instance.id || '')).filter(Boolean))];
  if (instanceIds.length === 0) return { engine, model: selectedModel, status: 'not_loaded', instances: 0 };

  for (const instanceId of instanceIds) {
    await axios.post(`${origin}/api/v1/models/unload`, {
      instance_id: instanceId,
    }, { headers: authHeaders(provider), timeout: 30000 });
  }
  return { engine, model: selectedModel, status: 'unloaded', instances: instanceIds.length };
};

export interface VisionInput {
  data: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';
}

export const completeVisionWithProvider = async (
  provider: StoredProvider,
  model: string,
  image: VisionInput,
  prompt: string,
  systemMessage: string,
  ttlSeconds = 1800,
  maxOutputTokens = 4096,
  signal?: AbortSignal,
) => {
  const baseUrl = provider.baseUrl.replace(/\/$/, '');
  const selectedModel = model.trim();
  if (!selectedModel) throw new Error('A vision model is required');
  const startedAt = Date.now();
  writeAuditLog({
    source: 'llm',
    direction: 'outbound',
    event: 'llm.vision.request',
    message: `Image envoyée à ${provider.name}`,
    status: 'sending',
    userId: provider.userId,
    details: {
      providerId: provider.id,
      type: provider.type,
      baseUrl,
      model: selectedModel,
      prompt,
      imageMimeType: image.mimeType,
      imageBytes: Buffer.byteLength(image.data, 'base64'),
    },
  });

  try {
    let content = '';
    let responseData: unknown;
    const localEngine = detectLocalProviderEngine(provider);
    const normalizedTtlSeconds = Math.min(7200, Math.max(900, Math.round(ttlSeconds)));
    const normalizedMaxOutputTokens = Math.min(4096, Math.max(256, Math.round(maxOutputTokens)));
    if (localEngine === 'ollama') {
      const response = await axios.post(`${nativeServiceOrigin(provider)}/api/chat`, {
        model: selectedModel,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: prompt, images: [image.data] },
        ],
        stream: false,
        keep_alive: `${normalizedTtlSeconds}s`,
        options: { temperature: 0.2, num_predict: normalizedMaxOutputTokens },
      }, { headers: authHeaders(provider), timeout: 120000, signal });
      responseData = response.data;
      if (response.data?.error) {
        const providerError = typeof response.data.error === 'string'
          ? response.data.error
          : response.data.error.message;
        throw new Error(providerError || 'Ollama vision request failed');
      }
      content = response.data.message?.content || '';
    } else if (provider.type === 'anthropic') {
      const response = await axios.post(`${baseUrl}/v1/messages`, {
        model: selectedModel,
        max_tokens: normalizedMaxOutputTokens,
        temperature: 0.2,
        system: systemMessage,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } },
            { type: 'text', text: prompt },
          ],
        }],
      }, { headers: { ...authHeaders(provider), 'content-type': 'application/json' }, timeout: 120000, signal });
      responseData = response.data;
      content = response.data.content?.map((part: any) => part.text || '').join('') || '';
    } else if (provider.type === 'google') {
      const key = decryptApiKey(provider.apiKey);
      const response = await axios.post(`${baseUrl}/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`, {
        systemInstruction: { parts: [{ text: systemMessage }] },
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: image.mimeType, data: image.data } },
            { text: prompt },
          ],
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: normalizedMaxOutputTokens },
      }, { params: { key }, timeout: 120000, signal });
      responseData = response.data;
      content = response.data.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('') || '';
    } else {
      const response = await axios.post(`${baseUrl}/v1/chat/completions`, {
        model: selectedModel,
        messages: [
          { role: 'system', content: systemMessage },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}`, detail: 'high' } },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: normalizedMaxOutputTokens,
        ...(localEngine === 'lmstudio' ? { ttl: normalizedTtlSeconds } : {}),
      }, { headers: authHeaders(provider), timeout: 120000, signal });
      responseData = response.data;
      content = response.data.choices?.[0]?.message?.content || '';
    }

    writeAuditLog({
      source: 'llm',
      direction: 'inbound',
      event: 'llm.vision.response',
      message: `Analyse d'image reçue de ${provider.name}`,
      status: 'completed',
      durationMs: Date.now() - startedAt,
      userId: provider.userId,
      details: { providerId: provider.id, model: selectedModel, content, response: responseData },
    });
    return content.trim();
  } catch (error: any) {
    const cancelled = Boolean(signal?.aborted) || axios.isCancel(error);
    writeAuditLog({
      level: cancelled ? 'info' : 'error',
      source: 'llm',
      direction: 'inbound',
      event: cancelled ? 'llm.vision.cancelled' : 'llm.vision.failed',
      message: cancelled
        ? 'Analyse Vision annulée'
        : error.response?.data?.error?.message || error.message || 'Erreur vision',
      status: cancelled ? 'cancelled' : String(error.response?.status || 'failed'),
      durationMs: Date.now() - startedAt,
      userId: provider.userId,
      details: { providerId: provider.id, model: selectedModel, response: error.response?.data },
    });
    throw error;
  }
};
