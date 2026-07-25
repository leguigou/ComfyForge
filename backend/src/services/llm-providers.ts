import crypto from 'crypto';
import axios from 'axios';
import { validateServiceUrl } from '../security/service-url';

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

export const completeWithProvider = async (provider: StoredProvider, prompt: string, systemMessage: string) => {
  const baseUrl = provider.baseUrl.replace(/\/$/, '');
  if (provider.type === 'anthropic') {
    const response = await axios.post(`${baseUrl}/v1/messages`, {
      model: provider.model, max_tokens: 2048, temperature: 0.7,
      system: systemMessage, messages: [{ role: 'user', content: prompt }]
    }, { headers: { ...authHeaders(provider), 'content-type': 'application/json' }, timeout: 30000 });
    return response.data.content?.map((part: any) => part.text || '').join('') || '';
  }
  if (provider.type === 'google') {
    const key = decryptApiKey(provider.apiKey);
    const response = await axios.post(`${baseUrl}/v1beta/models/${encodeURIComponent(provider.model)}:generateContent`, {
      systemInstruction: { parts: [{ text: systemMessage }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, responseMimeType: 'application/json' }
    }, { params: { key }, timeout: 30000 });
    return response.data.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('') || '';
  }
  const response = await axios.post(`${baseUrl}/v1/chat/completions`, {
    model: provider.model,
    messages: [{ role: 'system', content: systemMessage }, { role: 'user', content: prompt }],
    temperature: 0.7
  }, { headers: authHeaders(provider), timeout: 30000 });
  return response.data.choices?.[0]?.message?.content || '';
};
