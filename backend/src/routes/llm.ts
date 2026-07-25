import express from 'express';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import db from '../services/database';
import { authenticate } from '../middleware/auth';
import { ServiceUrlError, validateServiceUrl } from '../security/service-url';
import {
  completeWithProvider,
  encryptApiKey,
  listProviderModels,
  PROVIDER_PRESETS,
  ProviderType,
  resolveProviderUrl,
  StoredProvider,
} from '../services/llm-providers';

const router = express.Router();
const DEFAULT_SYSTEM_MESSAGE = "You are a professional stable diffusion prompt engineer. Transform user's ideas into highly detailed English prompts. Output JSON with 'positive' and 'negative' keys.";
const allowedTypes = new Set<ProviderType>(['openai', 'anthropic', 'google']);

const getProvider = (userId: string, providerId?: unknown) => {
  if (typeof providerId === 'string' && providerId) {
    return db.prepare('SELECT * FROM llm_providers WHERE id = ? AND userId = ?').get(providerId, userId) as StoredProvider | undefined;
  }
  return db.prepare('SELECT * FROM llm_providers WHERE userId = ? AND isActive = 1').get(userId) as StoredProvider | undefined;
};

const publicProvider = (provider: StoredProvider) => ({
  id: provider.id,
  name: provider.name,
  type: provider.type,
  baseUrl: provider.baseUrl,
  model: provider.model,
  isActive: Boolean(provider.isActive),
  hasApiKey: Boolean(provider.apiKey),
});

const parseEnhancedContent = (content: string) => {
  let result = { positive: content, negative: '' };
  const block = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  let json = block;
  if (!json) {
    const start = content.indexOf('{');
    let depth = 0;
    for (let i = start; start >= 0 && i < content.length; i++) {
      if (content[i] === '{') depth++;
      if (content[i] === '}' && --depth === 0) { json = content.slice(start, i + 1); break; }
    }
  }
  if (json) {
    try {
      const parsed = JSON.parse(json);
      const positive = parsed.positive || parsed.prompt || parsed.positive_prompt || parsed.text;
      if (positive) result = { positive, negative: parsed.negative || parsed.negative_prompt || parsed.neg || '' };
    } catch { /* Plain text remains a valid fallback. */ }
  }
  if (result.positive === content) result.positive = content.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, '$1').trim();
  return result;
};

router.get('/presets', authenticate, (_req, res) => res.json(PROVIDER_PRESETS));

router.get('/providers', authenticate, (req, res) => {
  const userId = (req as any).user.id;
  const providers = db.prepare('SELECT * FROM llm_providers WHERE userId = ? ORDER BY isActive DESC, createdAt ASC').all(userId) as StoredProvider[];
  res.json(providers.map(publicProvider));
});

// Compatibility endpoints for existing local OpenAI-compatible configurations.
router.post('/models', authenticate, async (req, res) => {
  try {
    const targetUrl = validateServiceUrl(req.body.llmUrl, 'LLM');
    const response = await axios.get(`${targetUrl}/v1/models`, { timeout: 10000 });
    res.json({ models: (response.data.data || []).map((model: any) => model.id) });
  } catch (error: any) {
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ error: error.message });
    res.status(502).json({ error: 'Failed to fetch models' });
  }
});

router.post('/check', authenticate, async (req, res) => {
  try {
    const targetUrl = validateServiceUrl(req.body.llmUrl, 'LLM');
    const response = await axios.get(`${targetUrl}/v1/models`, { timeout: 5000 });
    res.json({ success: true, count: response.data.data?.length || 0 });
  } catch (error: any) {
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ success: false, error: error.message });
    res.status(502).json({ success: false, error: 'LLM connection failed' });
  }
});

router.post('/discover-models', authenticate, async (req, res) => {
  try {
    const { name, type, presetId, baseUrl, apiKey } = req.body;
    if (!allowedTypes.has(type)) return res.status(400).json({ error: 'Unsupported provider API type' });
    const preset = PROVIDER_PRESETS.find(item => item.id === presetId);
    if (preset && preset.type !== type) return res.status(400).json({ error: 'Provider type does not match preset' });
    if ((preset?.requiresApiKey ?? true) && (typeof apiKey !== 'string' || !apiKey.trim())) {
      return res.status(400).json({ error: 'API key is required' });
    }
    const now = Date.now();
    const provider: StoredProvider = {
      id: 'discovery', userId: (req as any).user.id,
      name: typeof name === 'string' ? name : preset?.name || 'Provider',
      type, baseUrl: resolveProviderUrl(presetId, baseUrl),
      model: preset?.defaultModel || '',
      apiKey: apiKey?.trim() ? encryptApiKey(apiKey.trim()) : null,
      isActive: 0, createdAt: now, updatedAt: now,
    };
    res.json({ models: await listProviderModels(provider) });
  } catch (error: any) {
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ error: error.message });
    res.status(502).json({ error: error.response?.data?.error?.message || error.message || 'Failed to fetch models' });
  }
});

router.post('/providers', authenticate, (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { name, type, presetId, baseUrl, model, apiKey } = req.body;
    if (typeof name !== 'string' || !name.trim() || typeof model !== 'string' || !model.trim()) {
      return res.status(400).json({ error: 'Provider name and model are required' });
    }
    if (!allowedTypes.has(type)) return res.status(400).json({ error: 'Unsupported provider API type' });
    const preset = PROVIDER_PRESETS.find(item => item.id === presetId);
    if (preset && preset.type !== type) return res.status(400).json({ error: 'Provider type does not match preset' });
    if ((preset?.requiresApiKey ?? true) && (typeof apiKey !== 'string' || !apiKey.trim())) {
      return res.status(400).json({ error: 'API key is required' });
    }
    const id = uuidv4();
    const now = Date.now();
    const count = (db.prepare('SELECT COUNT(*) count FROM llm_providers WHERE userId = ?').get(userId) as any).count;
    const resolvedUrl = resolveProviderUrl(presetId, baseUrl);
    const transaction = db.transaction(() => {
      if (count === 0) db.prepare('UPDATE llm_providers SET isActive = 0 WHERE userId = ?').run(userId);
      db.prepare(`INSERT INTO llm_providers (id, userId, name, type, baseUrl, model, apiKey, isActive, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id, userId, name.trim(), type, resolvedUrl, model.trim(), apiKey?.trim() ? encryptApiKey(apiKey.trim()) : null, count === 0 ? 1 : 0, now, now
        );
    });
    transaction();
    res.status(201).json(publicProvider(getProvider(userId, id)!));
  } catch (error: any) {
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message || 'Failed to add provider' });
  }
});

router.patch('/providers/:id', authenticate, (req, res) => {
  try {
    const userId = (req as any).user.id;
    const provider = getProvider(userId, req.params.id);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });
    const model = typeof req.body.model === 'string' ? req.body.model.trim() : provider.model;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : provider.name;
    const baseUrl = typeof req.body.baseUrl === 'string' && req.body.baseUrl.trim()
      ? validateServiceUrl(req.body.baseUrl, 'LLM') : provider.baseUrl;
    if (!model || !name) return res.status(400).json({ error: 'Provider name and model are required' });
    const apiKey = typeof req.body.apiKey === 'string' && req.body.apiKey.trim()
      ? encryptApiKey(req.body.apiKey.trim()) : provider.apiKey;
    db.prepare('UPDATE llm_providers SET name = ?, model = ?, baseUrl = ?, apiKey = ?, updatedAt = ? WHERE id = ? AND userId = ?')
      .run(name, model, baseUrl, apiKey, Date.now(), provider.id, userId);
    res.json(publicProvider(getProvider(userId, provider.id)!));
  } catch (error: any) {
    if (error instanceof ServiceUrlError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message || 'Failed to update provider' });
  }
});

router.post('/providers/:id/activate', authenticate, (req, res) => {
  const userId = (req as any).user.id;
  const provider = getProvider(userId, req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  db.transaction(() => {
    db.prepare('UPDATE llm_providers SET isActive = 0 WHERE userId = ?').run(userId);
    db.prepare('UPDATE llm_providers SET isActive = 1, updatedAt = ? WHERE id = ? AND userId = ?').run(Date.now(), provider.id, userId);
  })();
  res.json({ success: true });
});

router.delete('/providers/:id', authenticate, (req, res) => {
  const userId = (req as any).user.id;
  const provider = getProvider(userId, req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });
  db.transaction(() => {
    db.prepare('DELETE FROM llm_providers WHERE id = ? AND userId = ?').run(provider.id, userId);
    if (provider.isActive) {
      const next = db.prepare('SELECT id FROM llm_providers WHERE userId = ? ORDER BY createdAt ASC LIMIT 1').get(userId) as any;
      if (next) db.prepare('UPDATE llm_providers SET isActive = 1 WHERE id = ?').run(next.id);
    }
  })();
  res.json({ success: true });
});

router.post('/providers/:id/models', authenticate, async (req, res) => {
  try {
    const provider = getProvider((req as any).user.id, req.params.id);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });
    res.json({ models: await listProviderModels(provider) });
  } catch (error: any) {
    res.status(502).json({ error: error.response?.data?.error?.message || error.message || 'Failed to fetch models' });
  }
});

router.post('/providers/:id/check', authenticate, async (req, res) => {
  try {
    const provider = getProvider((req as any).user.id, req.params.id);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });
    const models = await listProviderModels(provider);
    res.json({ success: true, count: models.length });
  } catch (error: any) {
    res.status(502).json({ success: false, error: error.response?.data?.error?.message || error.message || 'Connection failed' });
  }
});

router.post('/enhance-prompt', authenticate, async (req, res) => {
  try {
    const provider = getProvider((req as any).user.id, req.body.providerId);
    if (!provider) return res.status(400).json({ error: 'No active LLM provider' });
    const content = await completeWithProvider(provider, String(req.body.prompt || ''), req.body.systemMessage || DEFAULT_SYSTEM_MESSAGE);
    const result = parseEnhancedContent(content);
    res.json({ enhancedPrompt: result.positive, negativePrompt: result.negative });
  } catch (error: any) {
    res.status(502).json({ error: 'LLM Error: ' + (error.response?.data?.error?.message || error.message) });
  }
});

export default router;
