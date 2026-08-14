import { useState, type Dispatch, type SetStateAction } from 'react';
import toast from 'react-hot-toast';
import type { CivitaiModelLink, GenParameters, Language } from '../../types';
import { API_BASE } from '../../services/api';
import { CheckIcon, PlusIcon, RefreshIcon, TrashIcon, XIcon } from '../ui/Icons';

interface Candidate extends Omit<CivitaiModelLink, 'localModel' | 'modelType'> {
  modelId: number; modelVersionId: number; modelName: string; versionName: string; fileName: string; score: number;
}

interface Props {
  params: GenParameters;
  setParams: Dispatch<SetStateAction<GenParameters>>;
  lang: Language;
  comfyModels: string[];
  diffusionModels: string[];
}

const displayName = (value: string) => value.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || value;

export default function CivitaiPluginPanel({ params, setParams, lang, comfyModels, diffusionModels }: Props) {
  const fr = lang === 'fr';
  const favorites = params.favoriteModels || [];
  const links = params.civitaiModelLinks || [];
  const locals = [
    ...comfyModels.map(model => ({ model, modelType: 'checkpoint' as const })),
    ...diffusionModels.map(model => ({ model, modelType: 'diffusion' as const })),
  ].filter((item, index, all) => all.findIndex(other => other.model === item.model && other.modelType === item.modelType) === index);
  const displayed = [
    ...favorites.map(item => ({ model: item.model, modelType: item.modelType || 'checkpoint' as const })),
    ...links.map(item => ({ model: item.localModel, modelType: item.modelType })),
  ].filter((item, index, all) => all.findIndex(other => other.model === item.model && other.modelType === item.modelType) === index);
  const [open, setOpen] = useState(false);
  const [localModel, setLocalModel] = useState('');
  const [modelType, setModelType] = useState<'checkpoint' | 'diffusion'>('checkpoint');
  const [query, setQuery] = useState('');
  const [version, setVersion] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const store = (candidate: Candidate, model = localModel, type = modelType) => {
    if (!model) return;
    const link: CivitaiModelLink = { ...candidate, localModel: model, modelType: type };
    setParams(current => ({ ...current, civitaiModelLinks: [...(current.civitaiModelLinks || []).filter(item => !(item.localModel === model && item.modelType === type)), link] }));
    setCandidates([]); setOpen(false);
  };
  const search = async (model: string, type: 'checkpoint' | 'diffusion', customQuery?: string) => {
    setLocalModel(model); setModelType(type); setOpen(true); setSearching(true);
    try {
      const response = await fetch(`${API_BASE}/api/civitai/search`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ localFileName: model, query: customQuery }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Recherche Civitai impossible');
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      if (!data.candidates?.length) toast.error(fr ? 'Aucune correspondance trouvée' : 'No match found');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Civitai unavailable'); }
    finally { setSearching(false); }
  };
  const resolve = async () => {
    if (!localModel || !version.trim()) return;
    setSearching(true);
    try {
      const response = await fetch(`${API_BASE}/api/civitai/resolve`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ localFileName: localModel, modelVersionId: version }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Version Civitai introuvable');
      store(data.candidate); setVersion(''); toast.success(fr ? 'Modèle associé à Civitai' : 'Model linked to Civitai');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Civitai unavailable'); }
    finally { setSearching(false); }
  };
  const sync = async () => {
    const missing = favorites.filter(favorite => !links.some(link => link.localModel === favorite.model && link.modelType === (favorite.modelType || 'checkpoint')));
    if (!missing.length) return void toast.success(fr ? 'Tous les favoris sont déjà associés' : 'All favorites are already linked');
    setSyncing(true); const imported: CivitaiModelLink[] = [];
    try {
      for (const favorite of missing) {
        const response = await fetch(`${API_BASE}/api/civitai/search`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ localFileName: favorite.model }) });
        const data = await response.json().catch(() => ({}));
        const exact = response.ok ? (data.candidates as Candidate[] | undefined)?.find(item => item.score >= 130) : undefined;
        if (exact) imported.push({ ...exact, localModel: favorite.model, modelType: favorite.modelType || 'checkpoint' });
      }
      if (imported.length) setParams(current => ({ ...current, civitaiModelLinks: [...(current.civitaiModelLinks || []).filter(existing => !imported.some(link => link.localModel === existing.localModel && link.modelType === existing.modelType)), ...imported] }));
      toast.success(fr ? `${imported.length} favori(s) associé(s)${missing.length > imported.length ? ` · ${missing.length - imported.length} à vérifier` : ''}` : `${imported.length} favorite(s) linked${missing.length > imported.length ? ` · ${missing.length - imported.length} to review` : ''}`);
    } finally { setSyncing(false); }
  };

  return <div className="plugins-settings-stack"><section className="plugin-card civitai-plugin-card">
    <header className="plugin-card-header"><div className="plugin-brand"><span className="plugin-brand-mark">C</span><div><span className="plugin-eyebrow">Civitai</span><h4>{fr ? 'Association des modèles' : 'Model linking'}</h4><p>{fr ? 'Relie les modèles locaux à leur version Civitai pour intégrer automatiquement le hash et la ressource aux images.' : 'Links local models to their Civitai version so hashes and resources are embedded automatically.'}</p></div></div>
      <button type="button" className="civitai-add-button" disabled={!locals.length} title={fr ? 'Ajouter un modèle à lier' : 'Add a model link'} onClick={() => { const initial = locals.find(local => !links.some(link => link.localModel === local.model && link.modelType === local.modelType)) || locals[0]; if (initial) { setLocalModel(initial.model); setModelType(initial.modelType); } setCandidates([]); setOpen(true); }}><PlusIcon size={20} /></button>
    </header>
    <div className="civitai-sync-summary"><div><strong>{links.length}</strong><span>{fr ? 'modèle(s) associé(s)' : 'linked model(s)'}</span></div><button type="button" className="civitai-sync-button" disabled={syncing || !favorites.length} onClick={() => void sync()}><RefreshIcon size={17} />{!syncing && (fr ? 'Associer à Civitai' : 'Link with Civitai')}</button></div>
    <p className="civitai-sync-help">{fr ? 'Analyse uniquement les modèles favoris. Une association automatique exige une correspondance exacte du nom.' : 'Scans favorite models only. Automatic linking requires an exact name match.'}</p>
    {open && <div className="civitai-linker"><div className="civitai-linker-title"><strong>{fr ? 'Lier un modèle' : 'Link a model'}</strong><button type="button" onClick={() => { setOpen(false); setCandidates([]); }}><XIcon size={17} /></button></div>
      <div className="civitai-linker-fields"><label><span>{fr ? 'Modèle local' : 'Local model'}</span><select value={`${modelType}:${localModel}`} onChange={event => { const at = event.target.value.indexOf(':'); setModelType(event.target.value.slice(0, at) as 'checkpoint' | 'diffusion'); setLocalModel(event.target.value.slice(at + 1)); setCandidates([]); }}>{locals.map(local => <option key={`${local.modelType}:${local.model}`} value={`${local.modelType}:${local.model}`}>{local.model}</option>)}</select></label>
        <label><span>{fr ? 'Recherche intelligente' : 'Smart search'}</span><div className="civitai-inline-field"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={localModel.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')} /><button type="button" disabled={searching || !localModel} onClick={() => void search(localModel, modelType, query)}>{searching ? '…' : (fr ? 'Rechercher' : 'Search')}</button></div></label></div>
      <div className="civitai-version-field"><span>{fr ? 'Ou coller une URL / un ID de version' : 'Or paste a version URL / ID'}</span><div className="civitai-inline-field"><input value={version} onChange={event => setVersion(event.target.value)} placeholder="https://civitai.com/models/…?modelVersionId=…"/><button type="button" disabled={searching || !version.trim()} onClick={() => void resolve()}>{fr ? 'Associer' : 'Link'}</button></div></div>
      {!!candidates.length && <div className="civitai-candidate-list">{candidates.map((candidate, index) => <button key={`${candidate.modelVersionId}:${candidate.fileName}:${candidate.sha256 || index}`} type="button" onClick={() => { store(candidate); toast.success(fr ? 'Modèle associé à Civitai' : 'Model linked to Civitai'); }}><span><strong>{candidate.modelName}</strong><small>{candidate.versionName} · {candidate.fileName}</small></span><span className={candidate.score >= 130 ? 'exact' : ''}>{candidate.score >= 130 ? 'Exact' : `${candidate.score}%`}</span></button>)}</div>}
    </div>}
    <div className="civitai-linked-list">{displayed.map(item => { const link = links.find(candidate => candidate.localModel === item.model && candidate.modelType === item.modelType); return <div className={`civitai-linked-row ${link ? 'linked' : 'unlinked'}`} key={`${item.modelType}:${item.model}`}><span className="civitai-link-state">{link ? <CheckIcon size={16}/> : '!'}</span><span className="civitai-local-name"><strong>{displayName(item.model)}</strong><small>{item.model}</small></span><span className="civitai-remote-name">{link ? <><strong>{link.modelName}</strong><small>{link.versionName} · {link.autoV2 || 'Hash indisponible'}</small></> : <small>{fr ? 'Non associé' : 'Not linked'}</small>}</span><button type="button" className="civitai-row-action" disabled={searching} onClick={() => void search(item.model, item.modelType)}>{link ? (fr ? 'Modifier' : 'Change') : (fr ? 'Rechercher' : 'Search')}</button>{link && <button type="button" className="civitai-row-remove" title={fr ? 'Supprimer l’association' : 'Remove link'} onClick={() => setParams(current => ({ ...current, civitaiModelLinks: (current.civitaiModelLinks || []).filter(candidate => !(candidate.localModel === item.model && candidate.modelType === item.modelType)) }))}><TrashIcon size={16}/></button>}</div>; })}{!favorites.length && !links.length && <p className="favorite-model-empty">{fr ? 'Ajoute d’abord des modèles favoris dans l’onglet ComfyUI.' : 'Add favorite models in the ComfyUI tab first.'}</p>}</div>
  </section></div>;
}
