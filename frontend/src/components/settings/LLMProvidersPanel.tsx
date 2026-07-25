import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import type { GenParameters, LLMProvider } from '../../types';
import { API_BASE } from '../../services/api';
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
  setParams: (params: GenParameters) => void;
  t: Record<string, string>;
}

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

export const LLMProvidersPanel = ({ params, setParams, t }: Props) => {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('openai');
  const [draft, setDraft] = useState({ name: 'OpenAI / ChatGPT', type: 'openai' as LLMProvider['type'], baseUrl: 'https://api.openai.com', model: '', apiKey: '' });
  const [draftModels, setDraftModels] = useState<string[]>([]);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

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
            <div><strong>{provider.name}</strong><span>{provider.type} · {provider.hasApiKey ? '••••••••' : t.noKeyRequired || 'no key'}</span></div>
            {provider.isActive ? <span className="provider-active-badge">{t.active || 'Active'}</span> : <button className="action-btn-small" onClick={() => activate(provider)} disabled={busy === provider.id}>{t.activate || 'Activate'}</button>}
          </div>
          <div className="provider-url-editor">
            <label>{t.providerApiUrl || 'API URL'}</label>
            <input key={`${provider.id}-${provider.baseUrl}`} defaultValue={provider.baseUrl} onBlur={event => updateBaseUrl(provider, event.currentTarget.value, event.currentTarget)} disabled={busy === `url-${provider.id}`} />
          </div>
          <div className="model-select-group provider-model-row">
            {models[provider.id]?.length ? <select value={provider.model} onChange={event => updateModel(provider, event.target.value)}>{!models[provider.id].includes(provider.model) && <option>{provider.model}</option>}{models[provider.id].map(model => <option key={model}>{model}</option>)}</select> : <input value={provider.model} onChange={event => setProviders(value => value.map(item => item.id === provider.id ? { ...item, model: event.target.value } : item))} onBlur={event => updateModel(provider, event.target.value)} />}
            <button className="refresh-models-btn" onClick={() => fetchModels(provider)} disabled={busy === `models-${provider.id}`} title={t.refreshModels}>{busy === `models-${provider.id}` ? '…' : <RefreshIcon size={16} />}</button>
            <button className="provider-delete-btn" onClick={() => remove(provider)} disabled={busy === provider.id} title={t.delete}>×</button>
          </div>
        </div>)}
      </div>
    </div>
  );
};
