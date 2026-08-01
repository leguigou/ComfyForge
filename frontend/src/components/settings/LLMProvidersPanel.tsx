import { useCallback, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import toast from 'react-hot-toast';
import type { GenParameters, LLMProvider } from '../../types';
import { API_BASE } from '../../services/api';
import { DEFAULT_VISION_SYSTEM_MESSAGE } from '../../config';
import { RefreshIcon } from '../ui/Icons';

interface ProviderPreset {
  id: string;
  name: string;
  type: LLMProvider['type'];
  baseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
}

interface Props {
  params: GenParameters;
  setParams: Dispatch<SetStateAction<GenParameters>>;
  t: Record<string, string>;
  beforeVision?: ReactNode;
}

const VISION_TTL_OPTIONS = [15, 30, 60, 120] as const;

const request = async (path: string, init?: RequestInit) => {
  const response = await fetch(`${API_BASE}/api/llm${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : { error: await response.text() };
  if (response.status === 404) {
    throw new Error('Le backend doit être redémarré pour activer la gestion des providers IA.');
  }
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
};

export const LLMProvidersPanel = ({ params, setParams, t, beforeVision }: Props) => {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('openai');
  const [draft, setDraft] = useState({ name: 'OpenAI / ChatGPT', type: 'openai' as LLMProvider['type'], baseUrl: 'https://api.openai.com', model: '', apiKey: '' });
  const [draftModels, setDraftModels] = useState<string[]>([]);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const visionTtlMinutes = VISION_TTL_OPTIONS.includes(params.visionModelTtlMinutes as typeof VISION_TTL_OPTIONS[number])
    ? params.visionModelTtlMinutes
    : 30;
  const visionTtlIndex = VISION_TTL_OPTIONS.indexOf(visionTtlMinutes as typeof VISION_TTL_OPTIONS[number]);

  const loadProviders = useCallback(async () => {
    const data = await request('/providers');
    setProviders(data);
    const active = (data as LLMProvider[]).find(provider => provider.isActive);
    if (active && (params.llmProviderId !== active.id || params.llmModel !== active.model)) {
      setParams({ ...params, llmProviderId: active.id, llmModel: active.model, llmUrl: '' });
    }
  }, [params, setParams]);

  useEffect(() => {
    Promise.all([request('/presets'), request('/providers')]).then(([presetData, providerData]) => {
      setPresets(presetData);
      setProviders(providerData);
      const active = (providerData as LLMProvider[]).find(provider => provider.isActive);
      if (active) setParams({ ...params, llmProviderId: active.id, llmModel: active.model, llmUrl: '' });
    }).catch(error => toast.error(error.message, { id: 'llm-provider-load' }));
    // Loading is intentionally limited to mounting the settings panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choosePreset = (id: string) => {
    setSelectedPreset(id);
    const preset = presets.find(item => item.id === id);
    setDraftModels([]);
    if (preset) setDraft({ name: preset.name, type: preset.type, baseUrl: preset.baseUrl, model: '', apiKey: '' });
    else setDraft({ name: '', type: 'openai', baseUrl: '', model: '', apiKey: '' });
  };

  const discoverModels = async () => {
    setBusy('discover');
    try {
      const data = await request('/discover-models', {
        method: 'POST',
        body: JSON.stringify({ ...draft, presetId: selectedPreset === 'custom' ? undefined : selectedPreset }),
      });
      const availableModels = Array.isArray(data.models) ? data.models : [];
      setDraftModels(availableModels);
      const preset = presets.find(item => item.id === selectedPreset);
      const selectedModel = availableModels.includes(preset?.defaultModel || '')
        ? preset!.defaultModel
        : availableModels[0] || '';
      setDraft(value => ({ ...value, model: selectedModel }));
      if (availableModels.length) toast.success(`${availableModels.length} ${t.modelsFound}`);
      else toast.error(t.noModelsFound || 'No compatible model found');
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };

  const addProvider = async () => {
    setBusy('add');
    try {
      await request('/providers', { method: 'POST', body: JSON.stringify({ ...draft, presetId: selectedPreset === 'custom' ? undefined : selectedPreset }) });
      setDraft(value => ({ ...value, apiKey: '' }));
      setShowAdd(false);
      await loadProviders();
      toast.success(t.providerInstalled || 'Provider installed');
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };

  const activate = async (provider: LLMProvider) => {
    setBusy(provider.id);
    try {
      await request(`/providers/${provider.id}/activate`, { method: 'POST' });
      setParams({ ...params, llmProviderId: provider.id, llmModel: provider.model, llmUrl: '' });
      await loadProviders();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };

  const remove = async (provider: LLMProvider) => {
    if (!confirm(`${t.delete || 'Delete'} ${provider.name} ?`)) return;
    setBusy(provider.id);
    try { await request(`/providers/${provider.id}`, { method: 'DELETE' }); await loadProviders(); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };

  const fetchModels = async (provider: LLMProvider) => {
    setBusy(`models-${provider.id}`);
    try {
      const data = await request(`/providers/${provider.id}/models`, { method: 'POST' });
      setModels(value => ({ ...value, [provider.id]: data.models }));
      toast.success(`${data.models.length} ${t.modelsFound}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };

  const selectVisionProvider = async (providerId: string) => {
    const provider = providers.find(item => item.id === providerId);
    setParams(current => ({
      ...current,
      visionProviderId: providerId,
      visionModel: provider ? provider.model : '',
    }));
    if (!provider || models[provider.id]?.length) return;
    setBusy(`vision-models-${provider.id}`);
    try {
      const data = await request(`/providers/${provider.id}/models`, { method: 'POST' });
      const availableModels = Array.isArray(data.models) ? data.models : [];
      setModels(value => ({ ...value, [provider.id]: availableModels }));
      const preferredModel = availableModels.includes(provider.model) ? provider.model : availableModels[0] || provider.model;
      setParams(current => ({ ...current, visionProviderId: provider.id, visionModel: preferredModel }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const refreshVisionModels = async () => {
    const provider = providers.find(item => item.id === params.visionProviderId);
    if (!provider) return;
    setBusy(`vision-models-${provider.id}`);
    try {
      const data = await request(`/providers/${provider.id}/models`, { method: 'POST' });
      const availableModels = Array.isArray(data.models) ? data.models : [];
      setModels(value => ({ ...value, [provider.id]: availableModels }));
      const preferredModel = availableModels.includes(params.visionModel || '')
        ? params.visionModel!
        : availableModels.includes(provider.model) ? provider.model : availableModels[0] || '';
      setParams(current => ({ ...current, visionProviderId: provider.id, visionModel: preferredModel }));
      toast.success(`${availableModels.length} ${t.modelsFound}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const updateModel = async (provider: LLMProvider, model: string) => {
    setProviders(value => value.map(item => item.id === provider.id ? { ...item, model } : item));
    try {
      await request(`/providers/${provider.id}`, { method: 'PATCH', body: JSON.stringify({ model }) });
      if (provider.isActive) setParams({ ...params, llmProviderId: provider.id, llmModel: model, llmUrl: '' });
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); await loadProviders(); }
  };

  const updateBaseUrl = async (provider: LLMProvider, baseUrl: string, input: HTMLInputElement) => {
    const normalized = baseUrl.trim().replace(/\/$/, '');
    if (!normalized || normalized === provider.baseUrl.replace(/\/$/, '')) return;
    setBusy(`url-${provider.id}`);
    try {
      const updated = await request(`/providers/${provider.id}`, { method: 'PATCH', body: JSON.stringify({ baseUrl: normalized }) });
      setProviders(value => value.map(item => item.id === provider.id ? updated : item));
      setModels(value => ({ ...value, [provider.id]: [] }));
      toast.success(t.providerUrlUpdated || 'API URL updated');
    } catch (error) {
      input.value = provider.baseUrl;
      toast.error(error instanceof Error ? error.message : String(error));
    } finally { setBusy(null); }
  };

  const updateApiKey = async (provider: LLMProvider) => {
    const apiKey = apiKeys[provider.id]?.trim();
    if (!apiKey) return;
    setBusy(`key-${provider.id}`);
    try {
      const updated = await request(`/providers/${provider.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ apiKey }),
      });
      setProviders(value => value.map(item => item.id === provider.id ? updated : item));
      setApiKeys(value => ({ ...value, [provider.id]: '' }));
      setModels(value => ({ ...value, [provider.id]: [] }));
      toast.success(t.providerApiKeyUpdated || 'API key updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally { setBusy(null); }
  };

  return (
    <div className="llm-provider-panel">
      <div className="provider-toolbar">
        <div>
          <h3>{t.providers || 'AI providers'}</h3>
          <p>{t.providersHelp || 'Install several providers and choose the active one.'}</p>
        </div>
        <button className="action-btn-small" onClick={() => setShowAdd(value => !value)}>{showAdd ? t.cancel : `+ ${t.addProvider || 'Add provider'}`}</button>
      </div>

      {showAdd && <div className="provider-add-card">
        <label>{t.providerTemplate || 'Provider'}</label>
        <select value={selectedPreset} onChange={event => choosePreset(event.target.value)}>
          {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          <option value="custom">{t.customProvider || 'Custom (OpenAI compatible)'}</option>
        </select>
        <div className="provider-form-grid">
          <input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder={t.providerName || 'Name'} />
          <select value={draft.type} onChange={event => { setDraftModels([]); setDraft({ ...draft, type: event.target.value as LLMProvider['type'], model: '' }); }} disabled={selectedPreset !== 'custom'}>
            <option value="openai">OpenAI compatible</option><option value="anthropic">Anthropic</option><option value="google">Google Gemini</option>
          </select>
          <input value={draft.baseUrl} onChange={event => { setDraftModels([]); setDraft({ ...draft, baseUrl: event.target.value, model: '' }); }} placeholder="API URL" />
          <input className="provider-key-input" type="password" autoComplete="new-password" value={draft.apiKey} onChange={event => { setDraftModels([]); setDraft({ ...draft, apiKey: event.target.value, model: '' }); }} onKeyDown={event => { if (event.key === 'Enter' && (draft.apiKey || selectedPreset === 'ollama')) discoverModels(); }} placeholder={selectedPreset === 'ollama' ? `${t.apiKey || 'API key'} (${t.optional || 'optional'})` : t.apiKey || 'API key / token'} />
        </div>
        <p className="provider-security-note">{t.apiKeySecurity || 'The key is encrypted on the server and is never displayed again.'}</p>
        <button className="action-btn-small provider-discover-btn" onClick={discoverModels} disabled={busy === 'discover' || (!draft.apiKey && selectedPreset !== 'ollama')}>
          {busy === 'discover' ? '…' : t.loadProviderModels || 'Load models'}
        </button>
        {draftModels.length > 0 && <div className="provider-model-picker">
          <label>{t.llmModel}</label>
          <select value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })}>
            {draftModels.map(model => <option key={model} value={model}>{model}</option>)}
          </select>
        </div>}
        <button className="save-settings-btn provider-install-btn" onClick={addProvider} disabled={busy === 'add' || !draft.name || !draft.model}>{busy === 'add' ? '…' : t.installProvider || 'Install provider'}</button>
      </div>}

      <div className="provider-list">
        {providers.length === 0 && !showAdd && <div className="provider-empty">{t.noProviders || 'No provider installed yet.'}</div>}
        {providers.map(provider => <div key={provider.id} className={`provider-card ${provider.isActive ? 'active' : ''}`}>
          <div className="provider-card-head">
            <div>
              <strong>{provider.name}</strong>
              <span>{provider.type} · {provider.apiKeyPreview || (provider.hasApiKey ? '••••••••' : t.noKeyRequired || 'no key')}</span>
            </div>
            {provider.isActive ? <span className="provider-active-badge">{t.active || 'Active'}</span> : <button className="action-btn-small" onClick={() => activate(provider)} disabled={busy === provider.id}>{t.activate || 'Activate'}</button>}
          </div>
          <div className="provider-url-editor">
            <label>{t.providerApiUrl || 'API URL'}</label>
            <input key={`${provider.id}-${provider.baseUrl}`} defaultValue={provider.baseUrl} onBlur={event => updateBaseUrl(provider, event.currentTarget.value, event.currentTarget)} disabled={busy === `url-${provider.id}`} />
          </div>
          <div className="provider-key-editor">
            <label htmlFor={`provider-key-${provider.id}`}>{t.changeApiKey || 'Change API key'}</label>
            <div>
              <input
                id={`provider-key-${provider.id}`}
                type="password"
                autoComplete="new-password"
                value={apiKeys[provider.id] || ''}
                onChange={event => setApiKeys(value => ({ ...value, [provider.id]: event.target.value }))}
                onKeyDown={event => { if (event.key === 'Enter') updateApiKey(provider); }}
                placeholder={t.newApiKey || 'New API key / token'}
                disabled={busy === `key-${provider.id}`}
              />
              <button
                className="action-btn-small"
                onClick={() => updateApiKey(provider)}
                disabled={busy === `key-${provider.id}` || !apiKeys[provider.id]?.trim()}
              >
                {busy === `key-${provider.id}` ? '…' : t.saveApiKey || t.save || 'Save'}
              </button>
            </div>
          </div>
          <div className="model-select-group provider-model-row">
            {models[provider.id]?.length ? <select value={provider.model} onChange={event => updateModel(provider, event.target.value)}>{!models[provider.id].includes(provider.model) && <option>{provider.model}</option>}{models[provider.id].map(model => <option key={model}>{model}</option>)}</select> : <input value={provider.model} onChange={event => setProviders(value => value.map(item => item.id === provider.id ? { ...item, model: event.target.value } : item))} onBlur={event => updateModel(provider, event.target.value)} />}
            <button className="refresh-models-btn" onClick={() => fetchModels(provider)} disabled={busy === `models-${provider.id}`} title={t.refreshModels}>{busy === `models-${provider.id}` ? '…' : <RefreshIcon size={16} />}</button>
            <button className="provider-delete-btn" onClick={() => remove(provider)} disabled={busy === provider.id} title={t.delete}>×</button>
          </div>
        </div>)}
      </div>

      {beforeVision}

      <section className="vision-provider-card">
        <div className="vision-provider-heading">
          <div className="vision-provider-orb" aria-hidden="true"><span /></div>
          <div>
            <h3>{t.visionSetupTitle || 'Image analysis'}</h3>
            <p>{t.visionSetupHelp || 'Choose an installed provider and a model capable of reading images.'}</p>
          </div>
          <span className="vision-auto-save">{t.autoSaved || 'Auto-saved'}</span>
        </div>
        <div className="vision-provider-controls">
          <label>
            <span>{t.visionProvider || 'Vision provider'}</span>
            <select
              value={params.visionProviderId || ''}
              onChange={event => void selectVisionProvider(event.target.value)}
            >
              <option value="">{t.selectProvider || 'Select a provider'}</option>
              {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select>
          </label>
          <label>
            <span>{t.visionModel || 'Vision model'}</span>
            <div className="vision-model-control">
              {params.visionProviderId && models[params.visionProviderId]?.length ? (
                <select
                  value={params.visionModel || ''}
                  onChange={event => setParams(current => ({ ...current, visionModel: event.target.value }))}
                >
                  {!models[params.visionProviderId].includes(params.visionModel || '') && params.visionModel && (
                    <option value={params.visionModel}>{params.visionModel}</option>
                  )}
                  {models[params.visionProviderId].map(model => <option key={model} value={model}>{model}</option>)}
                </select>
              ) : (
                <input
                  value={params.visionModel || ''}
                  onChange={event => setParams(current => ({ ...current, visionModel: event.target.value }))}
                  placeholder={t.visionModelPlaceholder || 'e.g. gpt-4.1-mini'}
                  disabled={!params.visionProviderId}
                />
              )}
              <button
                type="button"
                className="refresh-models-btn"
                onClick={() => void refreshVisionModels()}
                disabled={!params.visionProviderId || busy === `vision-models-${params.visionProviderId}`}
                title={t.refreshModels}
              >
                {busy === `vision-models-${params.visionProviderId}` ? '…' : <RefreshIcon size={16} />}
              </button>
            </div>
          </label>
        </div>
        <p className="vision-provider-note">{t.visionModelNote || 'Only choose a multimodal model with image input support.'}</p>
        <div className="vision-ttl-control">
          <div className="vision-ttl-heading">
            <div>
              <strong>{t.visionTtlTitle || 'Automatic memory release'}</strong>
              <small>{t.visionTtlHelp || 'Unload the local vision model after this idle period.'}</small>
            </div>
            <output>{visionTtlMinutes < 60 ? `${visionTtlMinutes} min` : `${visionTtlMinutes / 60} h`}</output>
          </div>
          <input
            type="range"
            min="0"
            max={VISION_TTL_OPTIONS.length - 1}
            step="1"
            value={visionTtlIndex}
            onChange={event => {
              const value = VISION_TTL_OPTIONS[Number(event.target.value)] || 30;
              setParams(current => ({ ...current, visionModelTtlMinutes: value }));
            }}
            aria-label={t.visionTtlTitle || 'Automatic memory release'}
          />
          <div className="vision-ttl-ticks" aria-hidden="true">
            <span>15 min</span><span>30 min</span><span>1 h</span><span>2 h</span>
          </div>
        </div>
        <div className="vision-prompt-editor">
          <div className="vision-prompt-label">
            <span>{t.visionSystemMessage || 'Image analysis prompt'}</span>
            <small>{t.visionSystemMessageHelp || 'Controls how the model observes and describes the imported image.'}</small>
          </div>
          <div className="textarea-with-reset vision-textarea-with-reset">
            <textarea
              value={params.visionSystemMessage ?? DEFAULT_VISION_SYSTEM_MESSAGE}
              onChange={event => setParams(current => ({ ...current, visionSystemMessage: event.target.value }))}
              rows={8}
              maxLength={20000}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setParams(current => ({ ...current, visionSystemMessage: DEFAULT_VISION_SYSTEM_MESSAGE }))}
              disabled={(params.visionSystemMessage ?? DEFAULT_VISION_SYSTEM_MESSAGE) === DEFAULT_VISION_SYSTEM_MESSAGE}
              title={t.resetVisionSystemMessage || 'Reset the image analysis prompt'}
              aria-label={t.resetVisionSystemMessage || 'Reset the image analysis prompt'}
            >
              ↺
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
