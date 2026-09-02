import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { API_BASE } from '../../services/api';
import type { Language, Theme } from '../../types';
import comfyForgeLogo from '../../assets/comfyforge-logo-v2.webp';
import './AppLock.css';

export type AppLockMethod = 'pin' | 'pattern';

export interface AppLockConfig {
  enabled: boolean;
  method: AppLockMethod;
  timeoutMinutes: number;
  hasCredential: boolean;
  hasPin: boolean;
  pinLength: number;
  hasPattern: boolean;
}

type UnlockResult = { success: boolean; error?: string };

const DEFAULT_CONFIG: AppLockConfig = {
  enabled: false,
  method: 'pin',
  timeoutMinutes: 15,
  hasCredential: false,
  hasPin: false,
  pinLength: 4,
  hasPattern: false,
};

const storageKey = (username?: string) => `comfyforge.appLock.lastActivity.${(username || 'anonymous').toLowerCase()}`;

const readLastActivity = (username?: string) => {
  const value = Number(localStorage.getItem(storageKey(username)) || 0);
  return Number.isFinite(value) ? value : 0;
};

const writeLastActivity = (username: string | undefined, value: number) => {
  localStorage.setItem(storageKey(username), String(value));
};

export const useAppLock = (authenticated: boolean, username?: string) => {
  const [config, setConfig] = useState<AppLockConfig | null>(null);
  const [loading, setLoading] = useState(authenticated);
  const [locked, setLocked] = useState(false);
  const lastActivityRef = useRef(0);
  const lastWriteRef = useRef(0);

  const recordActivity = useCallback((forceWrite = false) => {
    const now = Date.now();
    lastActivityRef.current = now;
    if (forceWrite || now - lastWriteRef.current >= 5_000) {
      lastWriteRef.current = now;
      writeLastActivity(username, now);
    }
  }, [username]);

  useEffect(() => {
    if (!authenticated) {
      setConfig(null);
      setLocked(false);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    fetch(`${API_BASE}/api/auth/app-lock`, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`App lock status failed (${response.status})`);
        return response.json() as Promise<AppLockConfig>;
      })
      .then(nextConfig => {
        const normalized = { ...DEFAULT_CONFIG, ...nextConfig };
        setConfig(normalized);
        const lastActivity = readLastActivity(username);
        lastActivityRef.current = lastActivity;
        setLocked(normalized.enabled && (!lastActivity || Date.now() - lastActivity >= normalized.timeoutMinutes * 60_000));
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('Unable to load app lock status:', error);
        setConfig(DEFAULT_CONFIG);
        setLocked(false);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [authenticated, username]);

  useEffect(() => {
    if (!authenticated || !config?.enabled || locked) return;
    if (!lastActivityRef.current) recordActivity(true);

    const activity = () => recordActivity();
    const visibility = () => {
      if (document.visibilityState === 'hidden') recordActivity(true);
      else if (Date.now() - lastActivityRef.current >= config.timeoutMinutes * 60_000) setLocked(true);
      else recordActivity(true);
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    events.forEach(event => window.addEventListener(event, activity, { passive: true }));
    document.addEventListener('visibilitychange', visibility);
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= config.timeoutMinutes * 60_000) setLocked(true);
    }, 5_000);
    return () => {
      events.forEach(event => window.removeEventListener(event, activity));
      document.removeEventListener('visibilitychange', visibility);
      window.clearInterval(timer);
    };
  }, [authenticated, config, locked, recordActivity]);

  const verify = useCallback(async (credential: string, method?: AppLockMethod): Promise<UnlockResult> => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/app-lock/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credential, ...(method ? { method } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return { success: false, error: data.error };
      recordActivity(true);
      setLocked(false);
      return { success: true };
    } catch {
      return { success: false, error: 'network' };
    }
  }, [recordActivity]);

  const applyConfig = useCallback((nextConfig: AppLockConfig) => {
    setConfig(nextConfig);
    setLocked(false);
    recordActivity(true);
  }, [recordActivity]);

  const lockNow = useCallback(() => {
    if (config?.enabled) setLocked(true);
  }, [config?.enabled]);

  return { config, loading, locked, verify, applyConfig, lockNow };
};

const nodePosition = (index: number) => ({
  x: 16.667 + (index % 3) * 33.333,
  y: 16.667 + Math.floor(index / 3) * 33.333,
});

const distanceToSegment = (point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  const x = start.x + t * dx;
  const y = start.y + t * dy;
  return { distance: Math.hypot(point.x - x, point.y - y), t };
};

export const PatternInput = ({ onComplete, resetKey = 0, errorKey = 0, disabled = false, label }: {
  onComplete: (pattern: number[]) => void;
  resetKey?: number;
  errorKey?: number;
  disabled?: boolean;
  label: string;
}) => {
  const [selected, setSelected] = useState<number[]>([]);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const drawingRef = useRef(false);
  const selectedRef = useRef<number[]>([]);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const previousErrorKeyRef = useRef(errorKey);

  useEffect(() => {
    selectedRef.current = [];
    setSelected([]);
    setPointer(null);
  }, [resetKey]);

  useEffect(() => {
    if (!errorKey || errorKey === previousErrorKeyRef.current) return;
    previousErrorKeyRef.current = errorKey;
    setInvalid(true);
    const timer = window.setTimeout(() => setInvalid(false), 500);
    return () => window.clearTimeout(timer);
  }, [errorKey]);

  const relativePoint = (event: ReactPointerEvent) => {
    const rect = gridRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 };
  };

  const addNodesAlongPath = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    const additions = Array.from({ length: 9 }, (_, index) => {
      const hit = distanceToSegment(nodePosition(index), start, end);
      return { index, ...hit };
    }).filter(hit => hit.distance <= 9 && !selectedRef.current.includes(hit.index))
      .sort((left, right) => left.t - right.t)
      .map(hit => hit.index);
    if (!additions.length) return;
    selectedRef.current = [...selectedRef.current, ...additions];
    setSelected(selectedRef.current);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const point = relativePoint(event);
    const closest = Array.from({ length: 9 }, (_, index) => ({ index, distance: Math.hypot(nodePosition(index).x - point.x, nodePosition(index).y - point.y) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (closest.distance > 12) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    selectedRef.current = [closest.index];
    setSelected([closest.index]);
    setPointer(point);
    lastPointerRef.current = point;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return;
    const point = relativePoint(event);
    addNodesAlongPath(lastPointerRef.current || point, point);
    lastPointerRef.current = point;
    setPointer(point);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setPointer(null);
    onComplete([...selectedRef.current]);
  };

  const points = selected.map(index => nodePosition(index));
  const polyline = [...points, ...(pointer && drawingRef.current ? [pointer] : [])].map(point => `${point.x},${point.y}`).join(' ');

  return (
    <div ref={gridRef} className={`pattern-grid ${drawingRef.current ? 'drawing' : ''} ${invalid ? 'invalid' : ''}`} role="application" aria-label={label}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
      <svg viewBox="0 0 100 100" aria-hidden="true">{polyline && <polyline points={polyline} />}</svg>
      {Array.from({ length: 9 }, (_, index) => (
        <span key={index} className={`pattern-node ${selected.includes(index) ? 'selected' : ''}`} style={{ left: `${nodePosition(index).x}%`, top: `${nodePosition(index).y}%` }}><i /></span>
      ))}
    </div>
  );
};

export const AppLockScreen = ({ config, lang, theme, verify }: {
  config: AppLockConfig;
  lang: Language;
  theme: Theme;
  verify: (credential: string, method?: AppLockMethod) => Promise<UnlockResult>;
}) => {
  const [unlockMethod, setUnlockMethod] = useState<AppLockMethod>(() => {
    const desktopPrefersPin = window.matchMedia('(min-width: 769px)').matches;
    if (desktopPrefersPin && config.hasPin) return 'pin';
    if (config.method === 'pattern' && config.hasPattern) return 'pattern';
    if (config.method === 'pin' && config.hasPin) return 'pin';
    return config.hasPattern ? 'pattern' : 'pin';
  });
  const copy = lang === 'fr' ? {
    title: 'ComfyForge est verrouillé', pin: `Saisissez votre PIN à ${config.pinLength} chiffres`, pattern: 'Dessinez votre motif pour continuer',
    invalidPin: 'PIN incorrect. Réessayez.', invalidPattern: 'Motif incorrect. Réessayez.', network: 'Impossible de vérifier le code. Vérifiez la connexion.',
    patternLabel: 'Zone de saisie du motif de déverrouillage', usePin: 'Utiliser le PIN', usePattern: 'Utiliser le motif',
    pinUnavailable: 'PIN à configurer', patternUnavailable: 'Motif à configurer',
  } : {
    title: 'ComfyForge is locked', pin: `Enter your ${config.pinLength}-digit PIN`, pattern: 'Draw your pattern to continue',
    invalidPin: 'Incorrect PIN. Try again.', invalidPattern: 'Incorrect pattern. Try again.', network: 'Unable to verify the code. Check your connection.',
    patternLabel: 'Unlock pattern input area', usePin: 'Use PIN', usePattern: 'Use pattern',
    pinUnavailable: 'Set up PIN first', patternUnavailable: 'Set up pattern first',
  };
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [patternErrorKey, setPatternErrorKey] = useState(0);
  const [patternInvalid, setPatternInvalid] = useState(false);
  const [pinInvalid, setPinInvalid] = useState(false);
  const patternResetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (patternResetTimerRef.current !== null) window.clearTimeout(patternResetTimerRef.current);
  }, []);

  const submit = useCallback(async (credential: string) => {
    if (busy) return;
    setBusy(true);
    setPatternInvalid(false);
    setPinInvalid(false);
    setError('');
    const result = await verify(credential, unlockMethod);
    if (!result.success) {
      setError(result.error === 'network' ? copy.network : unlockMethod === 'pin' ? copy.invalidPin : copy.invalidPattern);
      if (unlockMethod === 'pattern' && result.error !== 'network') {
        setPatternInvalid(true);
        setPatternErrorKey(value => value + 1);
        patternResetTimerRef.current = window.setTimeout(() => {
          setResetKey(value => value + 1);
          setPatternInvalid(false);
          setBusy(false);
          patternResetTimerRef.current = null;
        }, 500);
        return;
      } else if (unlockMethod === 'pin' && result.error !== 'network') {
        setPinInvalid(true);
        patternResetTimerRef.current = window.setTimeout(() => {
          setPin('');
          setPinInvalid(false);
          setBusy(false);
          patternResetTimerRef.current = null;
        }, 500);
        return;
      } else {
        setPin('');
        setResetKey(value => value + 1);
      }
    }
    setBusy(false);
  }, [busy, copy.invalidPattern, copy.invalidPin, copy.network, unlockMethod, verify]);

  useEffect(() => {
    if (unlockMethod === 'pin' && pin.length === config.pinLength && !busy) void submit(pin);
  }, [busy, config.pinLength, pin, submit, unlockMethod]);

  const switchMethod = () => {
    if (busy || patternInvalid) return;
    if (patternResetTimerRef.current !== null) window.clearTimeout(patternResetTimerRef.current);
    patternResetTimerRef.current = null;
    setPin('');
    setError('');
    setPatternInvalid(false);
    setPinInvalid(false);
    setPatternErrorKey(0);
    setResetKey(value => value + 1);
    setUnlockMethod(current => current === 'pin' ? 'pattern' : 'pin');
  };

  const canSwitchMethod = unlockMethod === 'pattern' ? config.hasPin : config.hasPattern;
  const switchLabel = canSwitchMethod
    ? unlockMethod === 'pattern' ? copy.usePin : copy.usePattern
    : unlockMethod === 'pattern' ? copy.pinUnavailable : copy.patternUnavailable;

  return (
    <div className={`app-lock-screen ${theme}`}>
      <main className={`app-lock-card ${error ? 'has-error' : ''}`}>
        <img src={comfyForgeLogo} alt="ComfyForge" className="app-lock-logo" />
        <div className="app-lock-heading"><span className="app-lock-symbol" aria-hidden="true"><i /></span><h1>{copy.title}</h1><p>{unlockMethod === 'pin' ? copy.pin : copy.pattern}</p></div>
        {unlockMethod === 'pin' ? (
          <div className={`app-lock-pin-wrap ${pinInvalid ? 'invalid' : ''}`}>
            <input autoFocus className="app-lock-pin-input" type="password" inputMode="numeric" autoComplete="off" maxLength={config.pinLength} value={pin} disabled={busy}
              aria-label={copy.pin} aria-invalid={Boolean(error)} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, config.pinLength))} />
            <div className="app-lock-pin-dots" style={{ gridTemplateColumns: `repeat(${config.pinLength}, 1fr)` }} aria-hidden="true">{Array.from({ length: config.pinLength }, (_, index) => <span key={index} className={pin.length > index ? 'filled' : ''} />)}</div>
          </div>
        ) : (
          <PatternInput label={copy.patternLabel} disabled={busy || patternInvalid} resetKey={resetKey} errorKey={patternErrorKey} onComplete={pattern => {
            if (pattern.length >= 4) void submit(pattern.join('-'));
            else {
              setError(copy.invalidPattern);
              setPatternInvalid(true);
              setPatternErrorKey(value => value + 1);
              patternResetTimerRef.current = window.setTimeout(() => {
                setResetKey(value => value + 1);
                setPatternInvalid(false);
                patternResetTimerRef.current = null;
              }, 500);
            }
          }} />
        )}
        <button
          type="button"
          className={`app-lock-method-switch ${canSwitchMethod ? '' : 'unavailable'}`}
          disabled={!canSwitchMethod || busy || patternInvalid}
          title={!canSwitchMethod ? switchLabel : undefined}
          onClick={switchMethod}
        >
            <span aria-hidden="true">{unlockMethod === 'pattern' ? '••••' : '⌁'}</span>
            {switchLabel}
        </button>
        <div className="app-lock-feedback" role="status" aria-live="polite">{busy && !patternInvalid && !pinInvalid ? <span className="app-lock-spinner" aria-hidden="true" /> : error}</div>
      </main>
    </div>
  );
};

export const AppLockSettings = ({ config, lang, onConfigChange, onLockNow }: {
  config: AppLockConfig;
  lang: Language;
  onConfigChange: (config: AppLockConfig) => void;
  onLockNow: () => void;
}) => {
  const copy = lang === 'fr' ? {
    title: 'Verrouillage de l’application', help: 'Ajoutez une seconde vérification lorsque votre session est déjà connectée.', protection: 'Activer la protection',
    protectionHelp: 'ComfyForge demandera le code après la durée d’inactivité choisie.', method: 'Mode de déverrouillage', pin: 'PIN de 3 à 6 chiffres',
    pinHelp: 'La longueur du nouveau PIN détermine le nombre de cases.', pattern: 'Motif', patternHelp: 'Reliez au moins 4 points sur la grille.', timeout: 'Verrouiller après',
    setPin: 'Nouveau PIN', confirmPin: 'Confirmer le PIN', draw: 'Dessinez le nouveau motif', redraw: 'Dessinez-le une seconde fois', captured: 'Motif enregistré. Reproduisez-le pour confirmer.',
    mismatch: 'Les deux saisies ne correspondent pas.', tooShort: 'Utilisez au moins 4 points.', change: 'Modifier le code', cancelChange: 'Conserver le code actuel',
    configureFirst: 'Configurez ce mode pour activer la protection.', saving: 'Enregistrement automatique…', saved: 'Modifications enregistrées automatiquement.', failed: 'Impossible d’enregistrer la protection.', lockNow: 'Verrouiller maintenant',
    patternLabel: 'Grille de création du motif', configured: 'Configuré',
  } : {
    title: 'App lock', help: 'Add a second verification step while your account session remains signed in.', protection: 'Enable protection',
    protectionHelp: 'ComfyForge will request the code after the selected inactivity period.', method: 'Unlock method', pin: '3 to 6-digit PIN',
    pinHelp: 'The new PIN length determines the number of boxes.', pattern: 'Pattern', patternHelp: 'Connect at least 4 points on the grid.', timeout: 'Lock after',
    setPin: 'New PIN', confirmPin: 'Confirm PIN', draw: 'Draw the new pattern', redraw: 'Draw it a second time', captured: 'Pattern saved. Draw it again to confirm.',
    mismatch: 'The two entries do not match.', tooShort: 'Use at least 4 points.', change: 'Change code', cancelChange: 'Keep current code',
    configureFirst: 'Set up this method to enable protection.', saving: 'Saving automatically…', saved: 'Changes saved automatically.', failed: 'Unable to save protection.', lockNow: 'Lock now', patternLabel: 'Pattern creation grid', configured: 'Configured',
  };
  const [enabled, setEnabled] = useState(config.enabled);
  const [method, setMethod] = useState<AppLockMethod>(config.method);
  const [timeoutMinutes, setTimeoutMinutes] = useState(config.timeoutMinutes);
  const hasMethodCredential = (targetMethod: AppLockMethod) => targetMethod === 'pin' ? config.hasPin : config.hasPattern;
  const [editingCredential, setEditingCredential] = useState(!hasMethodCredential(config.method));
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [firstPattern, setFirstPattern] = useState<number[] | null>(null);
  const [patternResetKey, setPatternResetKey] = useState(0);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const lastAutoPinRef = useRef('');
  const savedConfigRef = useRef(config);
  savedConfigRef.current = config;

  const needsCredential = !hasMethodCredential(method) || editingCredential;
  const pinReady = /^\d{3,6}$/.test(pin) && confirmPin.length === pin.length && pin === confirmPin;

  const persist = useCallback(async (next: {
    enabled: boolean;
    method: AppLockMethod;
    timeoutMinutes: number;
    credential?: string;
  }, credentialChanged = false) => {
    setSaving(true);
    setStatus(copy.saving);
    try {
      const response = await fetch(`${API_BASE}/api/auth/app-lock`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(next),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || copy.failed);
      const nextConfig: AppLockConfig = { enabled: data.enabled, method: data.method, timeoutMinutes: data.timeoutMinutes, hasCredential: data.hasCredential, hasPin: data.hasPin, pinLength: data.pinLength, hasPattern: data.hasPattern };
      savedConfigRef.current = nextConfig;
      onConfigChange(nextConfig);
      setEnabled(nextConfig.enabled);
      setMethod(nextConfig.method);
      setTimeoutMinutes(nextConfig.timeoutMinutes);
      if (credentialChanged) {
        setEditingCredential(false);
        setPin('');
        setConfirmPin('');
        setFirstPattern(null);
        setPatternResetKey(value => value + 1);
      }
      setStatus(copy.saved);
    } catch (error) {
      if (!credentialChanged) {
        const savedConfig = savedConfigRef.current;
        setEnabled(savedConfig.enabled);
        setMethod(savedConfig.method);
        setTimeoutMinutes(savedConfig.timeoutMinutes);
      }
      setStatus(error instanceof Error ? error.message : copy.failed);
    } finally {
      setSaving(false);
    }
  }, [copy.failed, copy.saved, copy.saving, onConfigChange]);

  useEffect(() => {
    if (!pinReady || method !== 'pin' || !needsCredential || saving) return;
    const attempt = `${pin}:${confirmPin}`;
    if (lastAutoPinRef.current === attempt) return;
    lastAutoPinRef.current = attempt;
    void persist({ enabled, method, timeoutMinutes, credential: pin }, true);
  }, [confirmPin, enabled, method, needsCredential, persist, pin, pinReady, saving, timeoutMinutes]);

  const resetCredential = (nextMethod = method) => {
    lastAutoPinRef.current = '';
    setMethod(nextMethod); setPin(''); setConfirmPin(''); setFirstPattern(null); setPatternResetKey(value => value + 1); setStatus('');
    setEditingCredential(!hasMethodCredential(nextMethod));
  };

  const changeEnabled = (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    setStatus('');
    if (nextEnabled && !hasMethodCredential(method)) {
      setEditingCredential(true);
      setStatus(copy.configureFirst);
      return;
    }
    void persist({ enabled: nextEnabled, method, timeoutMinutes });
  };

  const changeMethod = (nextMethod: AppLockMethod) => {
    if (saving || nextMethod === method) return;
    resetCredential(nextMethod);
    if (enabled && !hasMethodCredential(nextMethod)) return;
    void persist({ enabled, method: nextMethod, timeoutMinutes });
  };

  const changeTimeout = (nextTimeoutMinutes: number) => {
    setTimeoutMinutes(nextTimeoutMinutes);
    setStatus('');
    if (enabled && !hasMethodCredential(method)) return;
    void persist({ enabled, method, timeoutMinutes: nextTimeoutMinutes });
  };

  const timeoutOptions = [
    [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, lang === 'fr' ? '1 heure' : '1 hour'],
    [120, lang === 'fr' ? '2 heures' : '2 hours'], [240, lang === 'fr' ? '4 heures' : '4 hours'], [480, lang === 'fr' ? '8 heures' : '8 hours'], [1440, lang === 'fr' ? '24 heures' : '24 hours'],
  ] as const;

  return (
    <div className="app-lock-settings">
      <section className="app-lock-settings-hero"><span className="app-lock-symbol" aria-hidden="true"><i /></span><div><h4>{copy.title}</h4><p>{copy.help}</p></div></section>
      <section className="app-lock-settings-section app-lock-protection-row"><div><h5>{copy.protection}</h5><p>{copy.protectionHelp}</p></div><label className="app-lock-switch"><input type="checkbox" checked={enabled} disabled={saving} onChange={event => changeEnabled(event.target.checked)} /><span aria-hidden="true" /></label></section>
      <section className="app-lock-settings-section"><h5>{copy.method}</h5><div className="app-lock-methods">
        <button type="button" disabled={saving} className={method === 'pin' ? 'active' : ''} onClick={() => changeMethod('pin')}><strong>••••</strong><span>{copy.pin}<small>{copy.pinHelp}{config.hasPin ? ` · ${copy.configured}` : ''}</small></span></button>
        <button type="button" disabled={saving} className={method === 'pattern' ? 'active' : ''} onClick={() => changeMethod('pattern')}><strong className="mini-pattern" aria-hidden="true">⌁</strong><span>{copy.pattern}<small>{copy.patternHelp}{config.hasPattern ? ` · ${copy.configured}` : ''}</small></span></button>
      </div></section>
      <section className="app-lock-settings-section app-lock-timeout-row"><label htmlFor="app-lock-timeout"><strong>{copy.timeout}</strong></label><select id="app-lock-timeout" value={timeoutMinutes} disabled={saving} onChange={event => changeTimeout(Number(event.target.value))}>{timeoutOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></section>
      {enabled && <section className="app-lock-settings-section app-lock-credential-editor">
        {!needsCredential ? <button type="button" className="app-lock-secondary-btn" onClick={() => setEditingCredential(true)}>{copy.change}</button>
          : method === 'pin' ? <><div className="app-lock-pin-fields">
              <label><span>{copy.setPin}</span><input type="password" inputMode="numeric" autoComplete="new-password" minLength={3} maxLength={6} value={pin} disabled={saving} onChange={event => { lastAutoPinRef.current = ''; setPin(event.target.value.replace(/\D/g, '').slice(0, 6)); }} /></label>
              <label><span>{copy.confirmPin}</span><input type="password" inputMode="numeric" autoComplete="new-password" minLength={3} maxLength={6} value={confirmPin} disabled={saving} onChange={event => { lastAutoPinRef.current = ''; setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 6)); }} /></label>
            </div>{pin.length >= 3 && confirmPin.length === pin.length && pin !== confirmPin && <p className="app-lock-inline-error">{copy.mismatch}</p>}</>
          : <div className="app-lock-pattern-editor"><p>{firstPattern ? copy.redraw : copy.draw}</p><PatternInput label={copy.patternLabel} resetKey={patternResetKey} disabled={saving} onComplete={pattern => {
              if (pattern.length < 4) { setStatus(copy.tooShort); setPatternResetKey(value => value + 1); return; }
              if (!firstPattern) { setFirstPattern(pattern); setStatus(copy.captured); }
              else {
                if (firstPattern.join('-') === pattern.join('-')) void persist({ enabled, method, timeoutMinutes, credential: firstPattern.join('-') }, true);
                else setStatus(copy.mismatch);
              }
              setPatternResetKey(value => value + 1);
            }} /></div>}
        {needsCredential && config.hasCredential && method === config.method && <button type="button" className="app-lock-text-btn" onClick={() => { setEditingCredential(false); resetCredential(config.method); }}>{copy.cancelChange}</button>}
      </section>}
      {config.enabled && <div className="app-lock-settings-actions"><button type="button" className="app-lock-secondary-btn" disabled={saving} onClick={onLockNow}>{copy.lockNow}</button></div>}
      {status && <p className={`app-lock-settings-status ${status === copy.saved || status === copy.captured ? 'success' : ''}`} role="status">{status}</p>}
    </div>
  );
};
