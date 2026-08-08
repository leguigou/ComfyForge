import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { GenParameters, Language, NodeMapping } from '../../types';
import { API_BASE } from '../../services/api';
import './OnboardingWizard.css';
import { CheckIcon, SparklesIcon } from '../ui/Icons';

type Props = {
  lang: Language;
  params: GenParameters;
  setParams: Dispatch<SetStateAction<GenParameters>>;
  onComplete: (params: GenParameters) => Promise<void>;
  onDismiss: () => void;
};

type ModelChoice = { name: string; type: 'checkpoint' | 'diffusion' };

export const OnboardingWizard = ({ lang, params, setParams, onComplete, onDismiss }: Props) => {
  const fr = lang === 'fr';
  const dialogRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [comfyUrl, setComfyUrl] = useState(params.comfyUrl);
  const [connectionReady, setConnectionReady] = useState(false);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [modelChoice, setModelChoice] = useState(`${params.comfyModelType}:${params.comfyModel}`);
  const [workflowFile, setWorkflowFile] = useState(params.workflowFile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  const checkConnection = async () => {
    setBusy(true);
    setError('');
    setConnectionReady(false);
    try {
      const response = await fetch(`${API_BASE}/api/comfy/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ comfyUrl })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'ComfyUI unavailable');
      setConnectionReady(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const discoverResources = async () => {
    setBusy(true);
    setError('');
    try {
      const [modelsResponse, workflowsResponse] = await Promise.all([
        fetch(`${API_BASE}/api/comfy/models`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ comfyUrl })
        }),
        fetch(`${API_BASE}/api/workflows`, { credentials: 'include' })
      ]);
      const modelData = await modelsResponse.json();
      const workflowData = await workflowsResponse.json();
      if (!modelsResponse.ok) throw new Error(modelData.error || 'Model discovery failed');
      if (!workflowsResponse.ok) throw new Error('Workflow discovery failed');

      const discovered: ModelChoice[] = [
        ...(Array.isArray(modelData.checkpoints) ? modelData.checkpoints : []).map((name: string) => ({ name, type: 'checkpoint' as const })),
        ...(Array.isArray(modelData.diffusionModels) ? modelData.diffusionModels : []).map((name: string) => ({ name, type: 'diffusion' as const }))
      ];
      const discoveredWorkflows = Array.isArray(workflowData) ? workflowData : [];
      setModels(discovered);
      setWorkflows(discoveredWorkflows);
      if (discovered.length && !discovered.some(item => `${item.type}:${item.name}` === modelChoice)) {
        setModelChoice(`${discovered[0].type}:${discovered[0].name}`);
      }
      if (discoveredWorkflows.length && !discoveredWorkflows.includes(workflowFile)) {
        setWorkflowFile(discoveredWorkflows[0]);
      }
      if (!discovered.length || !discoveredWorkflows.length) {
        throw new Error(fr
          ? 'Aucun modèle ou workflow compatible n’a été trouvé.'
          : 'No compatible model or workflow was found.');
      }
      setStep(2);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      const separator = modelChoice.indexOf(':');
      const modelType = modelChoice.slice(0, separator) as 'checkpoint' | 'diffusion';
      const comfyModel = modelChoice.slice(separator + 1);
      let workflowOverrides: Partial<GenParameters> = {};
      const mappingResponse = await fetch(`${API_BASE}/api/workflows/${encodeURIComponent(workflowFile)}/mapping`, {
        credentials: 'include'
      });
      if (mappingResponse.ok) {
        const mapping = await mappingResponse.json();
        const nodeMapping = mapping.nodeMapping as Partial<NodeMapping> | undefined;
        workflowOverrides = {
          ...(mapping.generationDefaults || {}),
          ...(nodeMapping ? { nodeMapping: { ...params.nodeMapping, ...nodeMapping } } : {})
        };
      }
      const configured: GenParameters = {
        ...params,
        ...workflowOverrides,
        comfyUrl,
        comfyModel,
        comfyModelType: modelType,
        workflowFile,
        onboardingCompleted: true
      };
      setParams(configured);
      await onComplete(configured);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-overlay">
      <section ref={dialogRef} className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding-progress" aria-label={fr ? 'Progression' : 'Progress'}>
          {[0, 1, 2, 3].map(index => <span key={index} className={index <= step ? 'active' : ''} />)}
        </div>

        {step === 0 && (
          <>
            <span className="onboarding-mark" aria-hidden="true"><SparklesIcon size={28} /></span>
            <h1 id="onboarding-title">{fr ? 'Bienvenue dans ComfyForge' : 'Welcome to ComfyForge'}</h1>
            <p>{fr
              ? 'Quelques vérifications suffisent pour relier votre installation ComfyUI et préparer une première création.'
              : 'A few checks will connect your ComfyUI installation and prepare your first creation.'}</p>
            <div className="onboarding-actions">
              <button type="button" className="secondary" onClick={onDismiss}>{fr ? 'Plus tard' : 'Later'}</button>
              <button type="button" autoFocus onClick={() => setStep(1)}>{fr ? 'Commencer' : 'Start'}</button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 id="onboarding-title">{fr ? 'Connexion à ComfyUI' : 'Connect to ComfyUI'}</h1>
            <p>{fr ? 'Cette adresse est utilisée uniquement par le serveur ComfyForge.' : 'This address is used only by the ComfyForge server.'}</p>
            <label htmlFor="onboarding-comfy-url">URL ComfyUI</label>
            <input
              id="onboarding-comfy-url"
              value={comfyUrl}
              onChange={event => { setComfyUrl(event.target.value); setConnectionReady(false); }}
              placeholder="http://127.0.0.1:8188"
              autoFocus
            />
            {connectionReady && <p className="onboarding-success" role="status"><CheckIcon size={18} /> {fr ? 'Connexion réussie' : 'Connection successful'}</p>}
            {error && <p className="onboarding-error" role="alert">{error}</p>}
            <div className="onboarding-actions">
              <button type="button" className="secondary" onClick={() => setStep(0)}>{fr ? 'Retour' : 'Back'}</button>
              <button type="button" onClick={connectionReady ? discoverResources : checkConnection} disabled={busy || !comfyUrl.trim()}>
                {busy ? '…' : connectionReady ? (fr ? 'Découvrir les ressources' : 'Discover resources') : (fr ? 'Tester la connexion' : 'Test connection')}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 id="onboarding-title">{fr ? 'Modèle et workflow' : 'Model and workflow'}</h1>
            <p>{fr ? 'Choisissez les valeurs utilisées par défaut. Elles resteront modifiables dans les paramètres.' : 'Choose the defaults. They can be changed later in settings.'}</p>
            <label htmlFor="onboarding-model">{fr ? 'Modèle' : 'Model'}</label>
            <select id="onboarding-model" value={modelChoice} onChange={event => setModelChoice(event.target.value)} autoFocus>
              {models.map(model => <option key={`${model.type}:${model.name}`} value={`${model.type}:${model.name}`}>{model.name}</option>)}
            </select>
            <label htmlFor="onboarding-workflow">Workflow</label>
            <select id="onboarding-workflow" value={workflowFile} onChange={event => setWorkflowFile(event.target.value)}>
              {workflows.map(workflow => <option key={workflow} value={workflow}>{workflow}</option>)}
            </select>
            {error && <p className="onboarding-error" role="alert">{error}</p>}
            <div className="onboarding-actions">
              <button type="button" className="secondary" onClick={() => setStep(1)}>{fr ? 'Retour' : 'Back'}</button>
              <button type="button" onClick={() => setStep(3)} disabled={!modelChoice || !workflowFile}>{fr ? 'Continuer' : 'Continue'}</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 id="onboarding-title">{fr ? 'Configuration prête' : 'Configuration ready'}</h1>
            <ul className="onboarding-summary">
              <li><strong>ComfyUI</strong><span>{comfyUrl}</span></li>
              <li><strong>{fr ? 'Modèle' : 'Model'}</strong><span>{modelChoice.slice(modelChoice.indexOf(':') + 1)}</span></li>
              <li><strong>Workflow</strong><span>{workflowFile}</span></li>
            </ul>
            {error && <p className="onboarding-error" role="alert">{error}</p>}
            <div className="onboarding-actions">
              <button type="button" className="secondary" onClick={() => setStep(2)}>{fr ? 'Retour' : 'Back'}</button>
              <button type="button" autoFocus onClick={() => void finish()} disabled={busy}>{busy ? '…' : (fr ? 'Terminer' : 'Finish')}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
};
