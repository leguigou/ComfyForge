import { lazy, Suspense, useState, useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import './SettingsModal.css';
import type { GenParameters, User, Language, GalleryItem, RandomPromptList, ComfyModelDetails } from '../../types';
import { normalizeRandomSlug } from '../../utils/randomPrompts';
import { DEFAULT_COMPANION_ID, normalizeCompanionSettings } from '../../utils/companions';
import { AlertTriangleIcon, CheckCircleIcon, CheckIcon, ClipboardIcon, DownloadIcon, HeartIcon, KeyIcon, PlusIcon, RefreshIcon, SparklesIcon, StarIcon, TrashIcon, XIcon } from '../ui/Icons';
import { SeedyCompanion } from '../chat/SeedyCompanion';
import { MarkdownLoader } from '../ui/MarkdownLoader';
import { formatBytes, getAvatarThumbnailUrl, getFullImageUrl, API_BASE } from '../../services/api';
import toast from 'react-hot-toast';
import { LLMProvidersPanel } from './LLMProvidersPanel';
import { AdminLogsPanel } from './AdminLogsPanel';
import { AdminQueuePanel } from './AdminQueuePanel';
import { APP_CONFIG, DEFAULT_LLM_SYSTEM_MESSAGE } from '../../config';
import { AppLockSettings, type AppLockConfig } from './AppLock';

interface WorkflowMappingData {
  filename: string;
  nodeMapping: Record<string, string | undefined>;
  nodes: Array<{ id: string; classType: string; title: string; inputs: string[] }>;
  samplerCount: number;
  generationDefaults?: Partial<{ width: number; height: number; steps: number; cfg: number; sampler: string; scheduler: string }>;
}

const workflowMappingKeys = ['checkpoint', 'diffusionModel', 'positive', 'negative', 'ksampler', 'latent', 'save'] as const;
const MAX_CUSTOM_COMPANIONS = 20;
const MAX_COMPANION_FILE_SIZE = 5_000_000;
const MAX_COMPANION_DATA_SIZE = 140_000_000;

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

const readImageDimensions = (file: File) => new Promise<{ width: number; height: number }>((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    resolve({ width: image.naturalWidth, height: image.naturalHeight });
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error('Invalid image'));
  };
  image.src = objectUrl;
});

type SettingsTab = SettingsModalProps['activeTab'];

const CivitaiPluginPanel = lazy(() => import('./CivitaiPluginPanel'));

const SettingsTabIcon = ({ tab }: { tab: SettingsTab }) => {
  const paths: Record<SettingsTab, React.ReactNode> = {
    general: <><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /><circle cx="12" cy="12" r="4" /></>,
    companions: <><path d="M8 4h8l3 4v8l-3 4H8l-3-4V8z" /><path d="M9 11h.01M15 11h.01M9 15c1.8 1.3 4.2 1.3 6 0" /></>,
    profile: <><circle cx="12" cy="8" r="3" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    images: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 5-5 4 4 2-2 5 4" /></>,
    random: <><path d="M4 7h3c4 0 4 10 8 10h5" /><path d="m17 14 3 3-3 3" /><path d="M4 17h3c1.5 0 2.5-1.5 3.5-3" /><path d="M14 7h6m-3-3 3 3-3 3" /></>,
    comfy: <><path d="M12 2v3m0 14v3M4.93 4.93l2.12 2.12m9.9 9.9 2.12 2.12M2 12h3m14 0h3M4.93 19.07l2.12-2.12m9.9-9.9 2.12-2.12" /><circle cx="12" cy="12" r="4" /></>,
    plugins: <><path d="M8 3v4M16 3v4M6 7h12v4a6 6 0 0 1-6 6v4" /><path d="M9 11h6" /></>,
    llm: <><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M8 10h.01M12 10h.01M16 10h.01M8 14h8M9 2v3m6-3v3" /></>,
    update: <><path d="M20 7v5h-5" /><path d="M18.5 16a8 8 0 1 1 .8-9L20 12" /></>,
    admin: <><path d="M12 3 4.5 6v5c0 4.8 3.2 8.5 7.5 10 4.3-1.5 7.5-5.2 7.5-10V6z" /><path d="m9 12 2 2 4-4" /></>,
    queue: <><path d="M5 6h14M5 12h14M5 18h14" /><circle cx="8" cy="6" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="16" cy="18" r="1" /></>,
    logs: <><path d="M4 5h16v14H4z" /><path d="M7 9h2m2 0h6M7 13h2m2 0h6M7 17h2m2 0h4" /></>
  };

  return (
    <svg className="settings-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[tab]}
    </svg>
  );
};

const SessionActionIcon = ({ type }: { type: 'archive' | 'delete' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {type === 'archive' ? (
      <>
        <rect x="4" y="7" width="16" height="13" rx="2" />
        <path d="M3 4h18v4H3zm6 8h6" />
      </>
    ) : (
      <>
        <path d="M4 7h16m-10 4v5m4-5v5M9 7l1-3h4l1 3m3 0-1 13H7L6 7" />
      </>
    )}
  </svg>
);

interface AdminUserUpdate {
  username: string;
  password?: string;
  isAdmin: boolean;
  avatarUrl: string | null;
  queueLimit: number | null;
}

interface ThumbnailCacheStats {
  fileCount: number;
  totalBytes: number;
}

interface PromptGroupRebuildStatus {
  status: 'idle' | 'dirty' | 'running' | 'complete' | 'error';
  processedPhotos: number;
  totalPhotos: number;
  groupsFormed: number;
  percent: number;
  manualGroupsPreserved: number;
  needsRebuild: boolean;
  completedAt?: number;
  error?: string;
}

type NewAdminUser = {
  username: string;
  password: string;
  isAdmin: boolean;
  queueLimit: number | null;
};

const CreateAdminUserModal = ({
  user,
  setUser,
  t,
  loading,
  onClose,
  onCreate
}: {
  user: NewAdminUser;
  setUser: (user: NewAdminUser) => void;
  t: Record<string, string>;
  loading: boolean;
  onClose: () => void;
  onCreate: () => Promise<{ success: boolean; error?: string }>;
}) => {
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const passwordMatches = user.password === confirmPassword;
  const canCreate = Boolean(user.username.trim() && user.password && passwordMatches) && !loading;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    setError('');
    const result = await onCreate();
    if (!result.success) {
      setError(result.error || t.userCreateFailed);
      return;
    }
    toast.success(t.userCreated);
    onClose();
  };

  return (
    <div className="admin-user-modal-overlay" onClick={() => { if (!loading) onClose(); }}>
      <form
        className="admin-user-modal admin-user-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-user-create-title"
        onSubmit={submit}
        onClick={event => event.stopPropagation()}
      >
        <header className="admin-user-modal-header">
          <div className="admin-user-identity">
            <div className="admin-user-avatar admin-user-create-avatar" aria-hidden="true">
              <PlusIcon size={23} />
            </div>
            <div>
              <span>{t.userManagement}</span>
              <h3 id="admin-user-create-title">{t.createUser}</h3>
            </div>
          </div>
          <button type="button" className="admin-user-modal-close" onClick={onClose} disabled={loading} aria-label={t.close}>
            <XIcon size={20} />
          </button>
        </header>

        <div className="admin-user-modal-body">
          <p className="admin-user-create-intro">{t.createUserHelp}</p>

          <section className="admin-user-form-section">
            <h4>{t.accountInformation}</h4>
            <div className="admin-user-form-grid">
              <label>
                <span>{t.username}</span>
                <input
                  value={user.username}
                  onChange={event => setUser({ ...user, username: event.target.value })}
                  autoFocus
                  autoComplete="off"
                  maxLength={100}
                  placeholder={t.username}
                />
              </label>
              <label>
                <span>{t.role}</span>
                <select value={user.isAdmin ? 'admin' : 'user'} onChange={event => setUser({ ...user, isAdmin: event.target.value === 'admin' })}>
                  <option value="user">{t.user}</option>
                  <option value="admin">{t.admin}</option>
                </select>
              </label>
            </div>
          </section>

          <section className="admin-user-form-section">
            <h4>{t.security}</h4>
            <div className="admin-user-form-grid">
              <label>
                <span>{t.password}</span>
                <input
                  type="password"
                  value={user.password}
                  onChange={event => setUser({ ...user, password: event.target.value })}
                  autoComplete="new-password"
                  maxLength={200}
                  placeholder={t.password}
                />
              </label>
              <label>
                <span>{t.confirmPassword}</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  aria-label={t.confirmPassword}
                  aria-invalid={Boolean(confirmPassword) && !passwordMatches}
                />
                {confirmPassword && !passwordMatches && <small className="admin-user-field-error">{t.passwordMismatch}</small>}
              </label>
            </div>
          </section>

          <section className="admin-user-form-section">
            <h4>{t.generationQueue}</h4>
            <div className="admin-user-queue-row">
              <label>
                <span>{t.queueQuota}</span>
                <select
                  value={user.queueLimit === null ? 'unlimited' : 'limited'}
                  onChange={event => setUser({
                    ...user,
                    queueLimit: event.target.value === 'unlimited' ? null : (user.queueLimit ?? 25)
                  })}
                >
                  <option value="limited">{t.limited}</option>
                  <option value="unlimited">{t.unlimited}</option>
                </select>
              </label>
              <label>
                <span>{t.queueQuotaValue}</span>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  value={user.queueLimit ?? 25}
                  disabled={user.queueLimit === null}
                  onChange={event => setUser({ ...user, queueLimit: Math.max(1, Math.min(10_000, Number(event.target.value) || 1)) })}
                />
              </label>
            </div>
          </section>

          {error && <div className="admin-user-save-error" role="alert">{error}</div>}
        </div>

        <footer className="admin-user-modal-footer admin-user-create-footer">
          <button type="button" className="admin-user-cancel" onClick={onClose} disabled={loading}>{t.cancel}</button>
          <button type="submit" className="admin-user-save" disabled={!canCreate}>
            {loading ? t.creating : <><PlusIcon size={17} /> {t.createUser}</>}
          </button>
        </footer>
      </form>
    </div>
  );
};

const AdminUserEditor = ({
  user,
  currentUsername,
  lang,
  t,
  onClose,
  onSave,
  onDelete
}: {
  user: User;
  currentUsername?: string;
  lang: Language;
  t: Record<string, string>;
  onClose: () => void;
  onSave: (id: string, updates: AdminUserUpdate) => Promise<{ success: boolean; error?: string }>;
  onDelete: (id: string) => void;
}) => {
  const initialLimit = user.queueLimit === undefined ? 25 : user.queueLimit;
  const [username, setUsername] = useState(user.username);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || '');
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [limited, setLimited] = useState(initialLimit !== null);
  const [queueLimit, setQueueLimit] = useState(String(initialLimit ?? 25));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isCurrentUser = user.username === currentUsername;

  const parsedLimit = Number(queueLimit);
  const validLimit = !limited || (Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 10_000);
  const validPassword = !password || password === confirmPassword;
  const canSave = Boolean(username.trim()) && validLimit && validPassword && !saving;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError('');
    const result = await onSave(user.id, {
      username: username.trim(),
      ...(password ? { password } : {}),
      isAdmin,
      avatarUrl: avatarUrl.trim() || null,
      queueLimit: limited ? parsedLimit : null
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error || t.userUpdateFailed);
      return;
    }
    toast.success(t.userUpdated);
    onClose();
  };

  return (
    <div className="admin-user-modal-overlay" onClick={onClose}>
      <form
        className="admin-user-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-user-modal-title"
        onSubmit={submit}
        onClick={event => event.stopPropagation()}
      >
        <header className="admin-user-modal-header">
          <div className="admin-user-identity">
            <div className="admin-user-avatar" aria-hidden="true">
              {avatarUrl ? <img src={encodeURI(getFullImageUrl(getAvatarThumbnailUrl(avatarUrl)))} alt="" /> : username.charAt(0).toUpperCase()}
            </div>
            <div>
              <span>{t.editUser}</span>
              <h3 id="admin-user-modal-title">{user.username}</h3>
            </div>
          </div>
          <button type="button" className="admin-user-modal-close" onClick={onClose} aria-label={t.close}>
            <XIcon size={20} />
          </button>
        </header>

        <div className="admin-user-modal-body">
          <section className="admin-user-form-section">
            <h4>{t.accountInformation}</h4>
            <div className="admin-user-form-grid">
              <label>
                <span>{t.username}</span>
                <input value={username} onChange={event => setUsername(event.target.value)} autoFocus maxLength={100} />
              </label>
              <label>
                <span>{t.role}</span>
                <select value={isAdmin ? 'admin' : 'user'} onChange={event => setIsAdmin(event.target.value === 'admin')} disabled={isCurrentUser}>
                  <option value="user">{t.user}</option>
                  <option value="admin">{t.admin}</option>
                </select>
                {isCurrentUser && <small>{t.cannotDemoteSelf}</small>}
              </label>
              <label className="admin-user-field-wide">
                <span>{t.avatarUrl}</span>
                <input value={avatarUrl} onChange={event => setAvatarUrl(event.target.value)} placeholder="/api/image-files/..." />
              </label>
            </div>
          </section>

          <section className="admin-user-form-section">
            <h4>{t.security}</h4>
            <div className="admin-user-form-grid">
              <label>
                <span>{t.newPassword}</span>
                <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" placeholder={t.leaveBlankPassword} maxLength={200} />
              </label>
              <label>
                <span>{t.confirmPassword}</span>
                <input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" />
                {!validPassword && <small className="admin-user-field-error">{t.passwordMismatch}</small>}
              </label>
            </div>
          </section>

          <section className="admin-user-form-section">
            <h4>{t.generationQueue}</h4>
            <div className="admin-user-queue-row">
              <label>
                <span>{t.queueQuota}</span>
                <select value={limited ? 'limited' : 'unlimited'} onChange={event => setLimited(event.target.value === 'limited')}>
                  <option value="limited">{t.limited}</option>
                  <option value="unlimited">{t.unlimited}</option>
                </select>
              </label>
              <label>
                <span>{t.queueQuotaValue}</span>
                <input type="number" min="1" max="10000" step="1" value={queueLimit} disabled={!limited} onChange={event => setQueueLimit(event.target.value)} />
                {!validLimit && <small className="admin-user-field-error">1–10 000</small>}
              </label>
            </div>
          </section>

          <section className="admin-user-stats" aria-label={t.userInformation}>
            <div><span>{t.images}</span><strong>{user.imageCount || 0}</strong></div>
            <div><span>{t.diskUsage}</span><strong>{formatBytes(user.diskUsage || 0)}</strong></div>
            <div><span>{t.activeQueue}</span><strong>{user.activeQueueCount || 0}</strong></div>
            <div><span>{t.createdAt}</span><strong>{user.createdAt ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(user.createdAt) : '—'}</strong></div>
          </section>

          <div className="admin-user-id"><span>ID</span><code>{user.id}</code></div>
          {error && <div className="admin-user-save-error" role="alert">{error}</div>}
        </div>

        <footer className="admin-user-modal-footer">
          <button type="button" className="admin-user-delete" disabled={isCurrentUser} onClick={() => { onDelete(user.id); onClose(); }}>
            <TrashIcon size={17} /> {t.deleteUser}
          </button>
          <div>
            <button type="button" className="admin-user-cancel" onClick={onClose}>{t.cancel}</button>
            <button type="submit" className="admin-user-save" disabled={!canSave}>{saving ? t.saving : t.save}</button>
          </div>
        </footer>
      </form>
    </div>
  );
};

interface SettingsModalProps {
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  activeTab: 'general' | 'companions' | 'profile' | 'lock' | 'images' | 'random' | 'comfy' | 'plugins' | 'llm' | 'update' | 'admin' | 'queue' | 'logs';
  setActiveTab: (tab: 'general' | 'companions' | 'profile' | 'lock' | 'images' | 'random' | 'comfy' | 'plugins' | 'llm' | 'update' | 'admin' | 'queue' | 'logs') => void;
  params: GenParameters;
  setParams: Dispatch<SetStateAction<GenParameters>>;
  settingsSaveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  onSaveSettings: (params: GenParameters, silent?: boolean) => Promise<boolean>;
  onPromptGroupsRebuilt: () => void;
  clipboardAutoGenerateSupported: boolean;
  isClipboardAutoGeneratePending: boolean;
  onClipboardAutoGenerateChange: (enabled: boolean) => Promise<void>;
  lang: Language;
  t: Record<string, string>;
  currentUser: User | null;
  appLockConfig: AppLockConfig;
  onAppLockConfigChange: (config: AppLockConfig) => void;
  onAppLockNow: () => void;
  comfyModels: string[];
  diffusionModels: string[];
  checkpointModelDetails: ComfyModelDetails[];
  diffusionModelDetails: ComfyModelDetails[];
  isFetchingComfyModels: boolean;
  fetchComfyModels: () => void;
  comfyStatus: { type: 'success' | 'error', msg: string } | null;
  testComfyConnection: () => void;
  isCheckingComfy: boolean;
  comfyCheckStatus: { type: 'success' | 'error', msg: string } | null;
  availableWorkflows: string[];
  fetchWorkflows: () => void;
  adminUsers: User[];
  newUser: NewAdminUser;
  setNewUser: (user: NewAdminUser) => void;
  handleAddUser: () => Promise<{ success: boolean; error?: string }>;
  isAdminLoading: boolean;
  deleteUser: (id: string) => void;
  updateAdminUser: (id: string, updates: AdminUserUpdate) => Promise<{ success: boolean; error?: string }>;
  requestArchiveAll: () => void;
  requestDeleteAll: () => void;
  updateProfile: (params: { username?: string; password?: string; avatarUrl?: string | null }) => Promise<{ success: boolean; error?: string }>;
  galleryItems: GalleryItem[];
  fetchGallery: (initial?: boolean) => void;
}

export const SettingsModal = ({
  showSettings,
  setShowSettings,
  activeTab,
  setActiveTab,
  params,
  setParams,
  settingsSaveState,
  onSaveSettings,
  onPromptGroupsRebuilt,
  clipboardAutoGenerateSupported,
  isClipboardAutoGeneratePending,
  onClipboardAutoGenerateChange,
  lang,
  t,
  currentUser,
  appLockConfig,
  onAppLockConfigChange,
  onAppLockNow,
  comfyModels,
  diffusionModels,
  checkpointModelDetails,
  diffusionModelDetails,
  isFetchingComfyModels,
  fetchComfyModels,
  comfyStatus,
  testComfyConnection,
  isCheckingComfy,
  comfyCheckStatus,
  availableWorkflows,
  fetchWorkflows,
  adminUsers,
  newUser,
  setNewUser,
  handleAddUser,
  isAdminLoading,
  deleteUser,
  updateAdminUser,
  requestArchiveAll,
  requestDeleteAll,
  updateProfile,
  galleryItems,
  fetchGallery
}: SettingsModalProps) => {
  const civitaiMetadataText = lang === 'fr' ? {
    title: 'Métadonnées Civitai au téléchargement',
    help: 'Ajoute le prompt et les paramètres de génération dans la copie WebP téléchargée. L’image originale reste inchangée.',
    enable: 'Désactivé',
    active: 'Activé',
    warning: 'Le prompt et le prompt négatif seront lisibles par Civitai et les logiciels compatibles.',
  } : {
    title: 'Civitai metadata on download',
    help: 'Adds the prompt and generation settings to the downloaded WebP copy. The original image remains unchanged.',
    enable: 'Disabled',
    active: 'Enabled',
    warning: 'The prompt and negative prompt will be readable by Civitai and compatible software.',
  };
  const [editUsername, setEditUsername] = useState(currentUser?.username || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [isUnloadingLlm, setIsUnloadingLlm] = useState(false);
  const [isFreeingComfyMemory, setIsFreeingComfyMemory] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [thumbnailCacheStats, setThumbnailCacheStats] = useState<ThumbnailCacheStats | null>(null);
  const [isInspectingThumbnailCache, setIsInspectingThumbnailCache] = useState(false);
  const [isPurgingThumbnailCache, setIsPurgingThumbnailCache] = useState(false);
  const [showThumbnailCacheConfirm, setShowThumbnailCacheConfirm] = useState(false);
  const [promptGroupRebuildStatus, setPromptGroupRebuildStatus] = useState<PromptGroupRebuildStatus | null>(null);
  const [isStartingPromptGroupRebuild, setIsStartingPromptGroupRebuild] = useState(false);
  const requestedPromptGroupRebuildRef = useRef(false);
  const reportedPromptGroupCompletionRef = useRef<number | null>(null);

  // Local states for textareas to allow manual save
  const [localNegativePrompt, setLocalNegativePrompt] = useState(params.negativePrompt);
  const [localLLMSystemMessage, setLocalLLMSystemMessage] = useState(params.llmSystemMessage);
  const [modelSearch, setModelSearch] = useState('');
  const [isImportingWorkflow, setIsImportingWorkflow] = useState(false);
  const [workflowToReplace, setWorkflowToReplace] = useState<string | null>(null);
  const [workflowMapping, setWorkflowMapping] = useState<WorkflowMappingData | null>(null);
  const [mappingDraft, setMappingDraft] = useState<Record<string, string>>({});
  const [isSavingMapping, setIsSavingMapping] = useState(false);
  const workflowFileInputRef = useRef<HTMLInputElement>(null);
  const companionFileInputRef = useRef<HTMLInputElement>(null);
  const activeTabButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const thumbnailCacheCancelRef = useRef<HTMLButtonElement>(null);
  const hydratedProfilesRef = useRef('');

  useEffect(() => {
    if (!showSettings || activeTab !== 'general') return;
    let cancelled = false;
    const loadStatus = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/gallery/prompt-group-cache/status`, { credentials: 'include' });
        const data = await response.json();
        if (!response.ok || cancelled) return;
        setPromptGroupRebuildStatus(data as PromptGroupRebuildStatus);
        if (
          requestedPromptGroupRebuildRef.current
          && data.status === 'complete'
          && typeof data.completedAt === 'number'
          && reportedPromptGroupCompletionRef.current !== data.completedAt
        ) {
          reportedPromptGroupCompletionRef.current = data.completedAt;
          requestedPromptGroupRebuildRef.current = false;
          onPromptGroupsRebuilt();
          toast.success(t.promptGroupingRebuildComplete);
        }
      } catch {
        // A later poll can recover from a transient status failure.
      }
    };
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(), 750);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeTab, onPromptGroupsRebuilt, showSettings, t.promptGroupingRebuildComplete]);

  const startPromptGroupRebuild = async () => {
    if (promptGroupRebuildStatus?.status === 'running' || isStartingPromptGroupRebuild) return;
    setIsStartingPromptGroupRebuild(true);
    try {
      const saved = await onSaveSettings(params, false);
      if (!saved) return;
      const response = await fetch(`${API_BASE}/api/gallery/prompt-group-cache/rebuild`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.promptGroupingRebuildFailed);
      requestedPromptGroupRebuildRef.current = true;
      setPromptGroupRebuildStatus(data as PromptGroupRebuildStatus);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.promptGroupingRebuildFailed);
    } finally {
      setIsStartingPromptGroupRebuild(false);
    }
  };

  const unloadLlmMemory = async () => {
    setIsUnloadingLlm(true);
    try {
      const response = await fetch(`${API_BASE}/api/llm/unload-models`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visionProviderId: params.visionProviderId,
          visionModel: params.visionModel,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data.code === 'NO_SUPPORTED_LOCAL_PROVIDER'
          ? t.llmMemoryUnsupported
          : data.error || t.llmMemoryReleaseFailed;
        throw new Error(message);
      }
      toast.success(data.unloaded > 0
        ? `${t.llmMemoryReleased} (${data.unloaded})`
        : t.llmMemoryAlreadyFree);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.llmMemoryReleaseFailed);
    } finally {
      setIsUnloadingLlm(false);
    }
  };

  const freeComfyMemory = async () => {
    setIsFreeingComfyMemory(true);
    try {
      const response = await fetch(`${API_BASE}/api/comfy/free`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comfyUrl: params.comfyUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t.comfyMemoryReleaseFailed);
      toast.success(t.comfyMemoryReleased);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.comfyMemoryReleaseFailed);
    } finally {
      setIsFreeingComfyMemory(false);
    }
  };

  const inspectThumbnailCache = async () => {
    setIsInspectingThumbnailCache(true);
    try {
      const response = await fetch(`${API_BASE}/api/image-files/thumbnail-cache`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(t.thumbnailCacheInspectFailed);
      const stats = {
        fileCount: Number(data.fileCount) || 0,
        totalBytes: Number(data.totalBytes) || 0,
      };
      setThumbnailCacheStats(stats);
      if (stats.fileCount === 0) {
        toast.success(t.thumbnailCacheEmpty);
      } else {
        setShowThumbnailCacheConfirm(true);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.thumbnailCacheInspectFailed);
    } finally {
      setIsInspectingThumbnailCache(false);
    }
  };

  const purgeThumbnailCacheFiles = async () => {
    setIsPurgingThumbnailCache(true);
    try {
      const response = await fetch(`${API_BASE}/api/image-files/thumbnail-cache`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(t.thumbnailCachePurgeFailed);
      const deletedStats = {
        fileCount: Number(data.fileCount) || 0,
        totalBytes: Number(data.totalBytes) || 0,
      };
      setThumbnailCacheStats({ fileCount: 0, totalBytes: 0 });
      setShowThumbnailCacheConfirm(false);
      toast.success(
        `${t.thumbnailCachePurged} (${new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US').format(deletedStats.fileCount)} · ${formatBytes(deletedStats.totalBytes)})`,
      );
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.thumbnailCachePurgeFailed);
    } finally {
      setIsPurgingThumbnailCache(false);
    }
  };

  useEffect(() => {
    if (showSettings) {
      setEditUsername(currentUser?.username || '');
      setNewPassword('');
      setConfirmPassword('');
      setLocalNegativePrompt(params.negativePrompt);
      setLocalLLMSystemMessage(params.llmSystemMessage);
      setModelSearch('');
    }
  }, [showSettings, currentUser, params.negativePrompt, params.llmSystemMessage]);

  useEffect(() => {
    if (!showThumbnailCacheConfirm) return;
    const frame = window.requestAnimationFrame(() => thumbnailCacheCancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [showThumbnailCacheConfirm]);

  useEffect(() => {
    if (!showSettings || activeTab !== 'comfy' || !params.workflowFile) return;
    let cancelled = false;
    setWorkflowMapping(null);
    fetch(`${API_BASE}/api/workflows/${encodeURIComponent(params.workflowFile)}/mapping`, { credentials: 'include' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Mapping unavailable');
        if (!cancelled) {
          setWorkflowMapping(data);
          setMappingDraft(Object.fromEntries(workflowMappingKeys.map(key => [key, data.nodeMapping?.[key] || ''])));
        }
      })
      .catch(error => {
        if (!cancelled) console.error('Error fetching workflow mapping:', error);
      });
    return () => { cancelled = true; };
  }, [showSettings, activeTab, params.workflowFile]);

  useEffect(() => {
    if (!showSettings) return;
    const favoritesWithWorkflow = (params.favoriteModels || []).filter(favorite => favorite.workflowFile);
    const signature = favoritesWithWorkflow.map(favorite => `${favorite.modelType || 'checkpoint'}:${favorite.model}:${favorite.workflowFile}`).sort().join('|');
    if (!signature || hydratedProfilesRef.current === signature) return;
    hydratedProfilesRef.current = signature;

    const workflowFiles = [...new Set(favoritesWithWorkflow.map(favorite => favorite.workflowFile))];
    Promise.all(workflowFiles.map(async filename => {
      const response = await fetch(`${API_BASE}/api/workflows/${encodeURIComponent(filename)}/mapping`, { credentials: 'include' });
      if (!response.ok) return [filename, undefined] as const;
      const data = await response.json();
      return [filename, data.generationDefaults] as const;
    })).then(entries => {
      const defaultsByWorkflow = new Map(entries);
      const favoriteModels = (params.favoriteModels || []).map(favorite => ({
        ...favorite,
        generationDefaults: defaultsByWorkflow.get(favorite.workflowFile) || favorite.generationDefaults
      }));
      setParams({ ...params, favoriteModels });
    }).catch(error => console.error('Error hydrating model defaults:', error));
  }, [showSettings, params, setParams]);

  useLayoutEffect(() => {
    if (!showSettings) return;
    const button = activeTabButtonRef.current;
    const tabList = button?.parentElement;
    if (!button || !tabList) return;

    const isHorizontal = window.getComputedStyle(tabList).flexDirection === 'row';
    if (isHorizontal) {
      tabList.scrollLeft = Math.max(0, button.offsetLeft - (tabList.clientWidth - button.offsetWidth) / 2);
    } else if (button.offsetTop < tabList.scrollTop) {
      tabList.scrollTop = button.offsetTop;
    } else if (button.offsetTop + button.offsetHeight > tabList.scrollTop + tabList.clientHeight) {
      tabList.scrollTop = button.offsetTop + button.offsetHeight - tabList.clientHeight;
    }
  }, [activeTab, showSettings]);

  useEffect(() => {
    if (!showSettings) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      if (!editingUser && !isCreatingUser) activeTabButtonRef.current?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (isCreatingUser) {
          if (!isAdminLoading) setIsCreatingUser(false);
          return;
        }
        if (editingUser) {
          setEditingUser(null);
          return;
        }
        setShowSettings(false);
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusRoot = modalRef.current.querySelector<HTMLElement>('.admin-user-modal') || modalRef.current;
      const focusable = [...focusRoot.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )].filter(element => !element.hasAttribute('hidden') && element.offsetParent !== null);
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
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [editingUser, isAdminLoading, isCreatingUser, setShowSettings, showSettings]);

  if (!showSettings) return null;

  const visibleModels = params.comfyModelType === 'diffusion' ? diffusionModels : comfyModels;
  const checkpointDetailsByName = new Map(checkpointModelDetails.map(model => [model.name, model]));
  const diffusionDetailsByName = new Map(diffusionModelDetails.map(model => [model.name, model]));
  const modelDetailsByName = params.comfyModelType === 'diffusion' ? diffusionDetailsByName : checkpointDetailsByName;
  const filteredModels = visibleModels.filter(m =>
    m.toLowerCase().includes(modelSearch.toLowerCase())
  );

  const favoriteModels = params.favoriteModels || [];

  /* Civitai panel logic is loaded on demand in CivitaiPluginPanel.
  const saveCivitaiLink = (candidate: CivitaiCandidate, localModel = civitaiLocalModel, modelType = civitaiLocalModelType) => {
    if (!localModel) return;
    const link: CivitaiModelLink = {
      localModel,
      modelType,
      modelId: candidate.modelId,
      modelVersionId: candidate.modelVersionId,
      modelName: candidate.modelName,
      versionName: candidate.versionName,
      fileName: candidate.fileName,
      baseModel: candidate.baseModel,
      air: candidate.air,
      autoV2: candidate.autoV2,
      sha256: candidate.sha256,
    };
    setParams(current => ({
      ...current,
      civitaiModelLinks: [...(current.civitaiModelLinks || []).filter(item => !(
        item.localModel === localModel && item.modelType === modelType
      )), link],
    }));
    setCivitaiCandidates([]);
    setShowCivitaiLinker(false);
  };

  const requestCivitaiCandidates = async (localModel: string, modelType: 'checkpoint' | 'diffusion', query?: string) => {
    setCivitaiLocalModel(localModel);
    setCivitaiLocalModelType(modelType);
    setShowCivitaiLinker(true);
    setIsSearchingCivitai(true);
    try {
      const response = await fetch(`${API_BASE}/api/civitai/search`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localFileName: localModel, query }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Recherche Civitai impossible');
      setCivitaiCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      if (!data.candidates?.length) toast.error(lang === 'fr' ? 'Aucune correspondance trouvée' : 'No match found');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Civitai unavailable');
    } finally {
      setIsSearchingCivitai(false);
    }
  };

  const resolveCivitaiVersionInput = async () => {
    if (!civitaiLocalModel || !civitaiVersionInput.trim()) return;
    setIsSearchingCivitai(true);
    try {
      const response = await fetch(`${API_BASE}/api/civitai/resolve`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localFileName: civitaiLocalModel, modelVersionId: civitaiVersionInput }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Version Civitai introuvable');
      saveCivitaiLink(data.candidate);
      setCivitaiVersionInput('');
      toast.success(lang === 'fr' ? 'Modèle associé à Civitai' : 'Model linked to Civitai');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Civitai unavailable');
    } finally {
      setIsSearchingCivitai(false);
    }
  };

  const syncFavoriteModelsWithCivitai = async () => {
    const missing = favoriteModels.filter(favorite => !civitaiModelLinks.some(link => (
      link.localModel === favorite.model && link.modelType === (favorite.modelType || 'checkpoint')
    )));
    if (!missing.length) {
      toast.success(lang === 'fr' ? 'Tous les favoris sont déjà associés' : 'All favorites are already linked');
      return;
    }
    setIsSyncingCivitai(true);
    const imported: CivitaiModelLink[] = [];
    try {
      for (const favorite of missing) {
        const response = await fetch(`${API_BASE}/api/civitai/search`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ localFileName: favorite.model }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) continue;
        const exact = (data.candidates as CivitaiCandidate[] | undefined)?.find(candidate => candidate.score >= 130);
        if (exact) imported.push({ ...exact, localModel: favorite.model, modelType: favorite.modelType || 'checkpoint' });
      }
      if (imported.length) setParams(current => ({
        ...current,
        civitaiModelLinks: [
          ...(current.civitaiModelLinks || []).filter(existing => !imported.some(link => (
            link.localModel === existing.localModel && link.modelType === existing.modelType
          ))),
          ...imported,
        ],
      }));
      const unresolved = missing.length - imported.length;
      toast.success(lang === 'fr'
        ? `${imported.length} favori(s) associé(s)${unresolved ? ` · ${unresolved} à vérifier` : ''}`
        : `${imported.length} favorite(s) linked${unresolved ? ` · ${unresolved} to review` : ''}`);
    } finally {
      setIsSyncingCivitai(false);
    }
  };
  */
  const activeFavorite = favoriteModels.find(item => (
    item.model === params.comfyModel && (item.modelType || 'checkpoint') === params.comfyModelType
  ));
  const activeDefaults = activeFavorite?.generationDefaults;

  const selectFavoriteModel = (model: string, workflowFile?: string, modelType: 'checkpoint' | 'diffusion' = 'checkpoint') => {
    const favorite = favoriteModels.find(item => item.model === model && (item.modelType || 'checkpoint') === modelType);
    setParams({
      ...params,
      comfyModel: model,
      comfyModelType: modelType,
      workflowFile: workflowFile || params.workflowFile,
      ...(favorite?.generationDefaults || {})
    });
  };

  const toggleFavoriteModel = (model: string, modelType: 'checkpoint' | 'diffusion' = params.comfyModelType) => {
    const existing = favoriteModels.some(item => item.model === model && (item.modelType || 'checkpoint') === modelType);
    setParams({
      ...params,
      favoriteModels: existing
        ? favoriteModels.filter(item => !(item.model === model && (item.modelType || 'checkpoint') === modelType))
        : [...favoriteModels, { model, workflowFile: '', modelType }]
    });
  };

  const updateFavoriteWorkflow = async (model: string, modelType: 'checkpoint' | 'diffusion', workflowFile: string) => {
    let generationDefaults = undefined;
    if (workflowFile) {
      try {
        const response = await fetch(`${API_BASE}/api/workflows/${encodeURIComponent(workflowFile)}/mapping`, { credentials: 'include' });
        if (response.ok) generationDefaults = (await response.json()).generationDefaults;
      } catch (error) {
        console.error('Error reading workflow defaults:', error);
      }
    }
    const isActiveModel = params.comfyModel === model && params.comfyModelType === modelType;
    setParams({
      ...params,
      workflowFile: isActiveModel && workflowFile ? workflowFile : params.workflowFile,
      ...(isActiveModel && generationDefaults ? generationDefaults : {}),
      favoriteModels: favoriteModels.map(item => (
        item.model === model && (item.modelType || 'checkpoint') === modelType
          ? { ...item, workflowFile, generationDefaults }
          : item
      ))
    });
  };

  const resetModelParameter = (key: 'width' | 'height' | 'steps' | 'cfg' | 'sampler' | 'scheduler') => {
    const defaultValue = activeDefaults?.[key];
    if (defaultValue === undefined) return;
    setParams({ ...params, [key]: defaultValue });
  };

  const switchModelType = (modelType: 'checkpoint' | 'diffusion') => {
    const targetModels = modelType === 'diffusion' ? diffusionModels : comfyModels;
    setModelSearch('');
    setParams({
      ...params,
      comfyModelType: modelType,
      comfyModel: targetModels.includes(params.comfyModel) ? params.comfyModel : (targetModels[0] || '')
    });
  };

  const getModelDisplayName = (model: string) => (
    model.split(/[\\/]/).pop()?.replace(/\.(safetensors|ckpt|pt)$/i, '') || model
  );

  const formatModelSize = (model?: ComfyModelDetails) => {
    const sizeGb = model?.sizeGb ?? (model?.sizeBytes !== undefined ? model.sizeBytes / 1_000_000_000 : undefined);
    if (sizeGb === undefined || !Number.isFinite(sizeGb)) return '';
    return `${new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 2 }).format(sizeGb)} ${lang === 'fr' ? 'Go' : 'GB'}`;
  };

  const handleImportWorkflow = async (file?: File) => {
    if (!file) return;
    const uploadedFilename = file.name.endsWith('.json') ? file.name : `${file.name}.json`;
    const filename = workflowToReplace || uploadedFilename;
    const exists = availableWorkflows.includes(filename);
    if (exists && !window.confirm(t.confirmReplaceWorkflow)) {
      if (workflowFileInputRef.current) workflowFileInputRef.current.value = '';
      return;
    }

    setIsImportingWorkflow(true);
    try {
      const workflow = JSON.parse(await file.text());
      const response = await fetch(`${API_BASE}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ filename, workflow, overwrite: exists })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.workflowImportFailed);
      setParams({
        ...params,
        workflowFile: data.filename,
        favoriteModels: favoriteModels.map(favorite => (
          favorite.workflowFile === data.filename
            ? { ...favorite, generationDefaults: data.generationDefaults }
            : favorite
        ))
      });
      await fetchWorkflows();
      toast.success(exists ? t.workflowUpdated : t.workflowImported);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.workflowImportFailed);
    } finally {
      setIsImportingWorkflow(false);
      setWorkflowToReplace(null);
      if (workflowFileInputRef.current) workflowFileInputRef.current.value = '';
    }
  };

  const handleDeleteWorkflow = async (filename: string) => {
    if (!window.confirm(`${t.confirmDeleteWorkflow} ${filename} ?`)) return;
    try {
      const response = await fetch(`${API_BASE}/api/workflows/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.workflowDeleteFailed);

      const remaining = availableWorkflows.filter(workflow => workflow !== filename);
      setParams({
        ...params,
        workflowFile: params.workflowFile === filename ? (remaining[0] || '') : params.workflowFile,
        favoriteModels: favoriteModels.map(favorite => (
          favorite.workflowFile === filename ? { ...favorite, workflowFile: '' } : favorite
        ))
      });
      await fetchWorkflows();
      toast.success(t.workflowDeleted);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.workflowDeleteFailed);
    }
  };

  const handleSaveWorkflowMapping = async () => {
    if (!params.workflowFile) return;
    setIsSavingMapping(true);
    try {
      const response = await fetch(`${API_BASE}/api/workflows/${encodeURIComponent(params.workflowFile)}/mapping`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ nodeMapping: mappingDraft })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.mappingSaveFailed);
      setWorkflowMapping(current => current ? { ...current, nodeMapping: data.nodeMapping } : current);
      setParams({
        ...params,
        favoriteModels: favoriteModels.map(favorite => (
          favorite.workflowFile === params.workflowFile
            ? { ...favorite, generationDefaults: data.generationDefaults }
            : favorite
        ))
      });
      toast.success(t.mappingSaved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.mappingSaveFailed);
    } finally {
      setIsSavingMapping(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (newPassword && newPassword !== confirmPassword) {
      toast.error(t.passwordsDoNotMatch);
      return;
    }

    setIsUpdating(true);
    const result = await updateProfile({
      username: editUsername !== currentUser?.username ? editUsername : undefined,
      password: newPassword || undefined
    });

    if (result.success) {
      toast.success(t.profileUpdated);
      setNewPassword('');
      setConfirmPassword('');
    } else {
      toast.error(result.error || t.profileUpdateFailed);
    }
    setIsUpdating(false);
  };

  const handleSaveTextarea = (field: 'negativePrompt' | 'llmSystemMessage') => {
    if (field === 'negativePrompt') {
      setParams({ ...params, negativePrompt: localNegativePrompt });
    } else {
      setParams({ ...params, llmSystemMessage: localLLMSystemMessage });
    }
    // The App.tsx saveSettings will pick up the change and show a toast
  };

  const resetLLMSystemMessage = () => {
    setLocalLLMSystemMessage(DEFAULT_LLM_SYSTEM_MESSAGE);
    setParams({ ...params, llmSystemMessage: DEFAULT_LLM_SYSTEM_MESSAGE });
  };

  const updateRandomList = (id: string, patch: Partial<RandomPromptList>) => {
    setParams({
      ...params,
      randomPromptLists: params.randomPromptLists.map(list => list.id === id ? { ...list, ...patch } : list)
    });
  };

  const addRandomList = () => {
    const id = `random-${Date.now()}`;
    setParams({
      ...params,
      randomPromptLists: [
        ...params.randomPromptLists,
        { id, name: t.newRandomList, slug: `R-List-${params.randomPromptLists.length + 1}`, values: [], enabled: true }
      ]
    });
  };

  const removeRandomList = (id: string) => {
    if (!window.confirm(t.confirmDeleteRandomList)) return;
    setParams({ ...params, randomPromptLists: params.randomPromptLists.filter(list => list.id !== id) });
  };

  const handleSelectAvatar = async (url: string) => {
    const result = await updateProfile({ avatarUrl: url });
    if (result.success) {
      toast.success(t.profileUpdated);
      setShowImagePicker(false);
    } else {
      toast.error(result.error || t.profileUpdateFailed);
    }
  };

  const openAvatarPicker = () => {
    setShowImagePicker(true);
    fetchGallery(true);
  };

  const handleRemoveAvatar = async () => {
    const result = await updateProfile({ avatarUrl: null });
    if (result.success) {
      toast.success(t.profileUpdated);
    } else {
      toast.error(result.error || t.profileUpdateFailed);
    }
  };

  const userInitial = currentUser?.username?.charAt(0).toUpperCase() || '?';
  const companionSettings = normalizeCompanionSettings(params.companionSettings);

  const updateCompanionName = (id: string, name: string) => {
    setParams({
      ...params,
      companionSettings: {
        ...companionSettings,
        companions: companionSettings.companions.map(companion => companion.id === id ? { ...companion, name } : companion),
      },
    });
  };

  const selectCompanion = (id: string) => {
    setParams({
      ...params,
      companionSettings: { ...companionSettings, enabled: true, activeId: id },
    });
  };

  const removeCompanion = (id: string) => {
    if (id === DEFAULT_COMPANION_ID || !window.confirm(t.confirmDeleteCompanion)) return;
    const companions = companionSettings.companions.filter(companion => companion.id !== id);
    setParams({
      ...params,
      companionSettings: {
        ...companionSettings,
        companions,
        activeId: companionSettings.activeId === id ? DEFAULT_COMPANION_ID : companionSettings.activeId,
      },
    });
  };

  const importCompanion = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const customCompanions = companionSettings.companions.filter(companion => companion.source === 'custom');
    if (customCompanions.length >= MAX_CUSTOM_COMPANIONS) {
      toast.error(t.companionLimitReached);
      return;
    }
    if (!['image/webp', 'image/png'].includes(file.type) || file.size > MAX_COMPANION_FILE_SIZE) {
      toast.error(t.companionFileInvalid);
      return;
    }

    try {
      const dimensions = await readImageDimensions(file);
      if (dimensions.width % 8 !== 0 || dimensions.height % 9 !== 0) {
        toast.error(t.companionGridInvalid);
        return;
      }
      const spriteDataUrl = await readFileAsDataUrl(file);
      const storedDataSize = customCompanions.reduce((total, companion) => (
        total + (companion.spriteBytes || Math.round((companion.spriteDataUrl?.length || 0) * 0.75))
      ), 0);
      if (storedDataSize + file.size > MAX_COMPANION_DATA_SIZE) {
        toast.error(t.companionStorageFull);
        return;
      }

      const id = `companion-${crypto.randomUUID()}`;
      const name = file.name.replace(/\.[^.]+$/, '') || t.newCompanion;
      const response = await fetch(`${API_BASE}/api/companions/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ spriteDataUrl })
      });
      const result = await response.json();
      if (!response.ok || !result.profile?.spriteUrl) {
        throw new Error(result.error || t.companionFileInvalid);
      }
      setParams({
        ...params,
        companionSettings: {
          enabled: true,
          activeId: id,
          companions: [...companionSettings.companions, {
            id,
            name,
            source: 'custom',
            spriteUrl: result.profile.spriteUrl,
            spriteMimeType: result.profile.spriteMimeType,
            spriteBytes: result.profile.spriteBytes,
            fileName: file.name,
          }],
        },
      });
      toast.success(t.companionImported);
    } catch {
      toast.error(t.companionFileInvalid);
    }
  };

  // Sort gallery: favorites first
  const sortedGallery = [...galleryItems].sort((a, b) => (b.isFavorite || 0) - (a.isFavorite || 0));

  const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'general', label: t.tabGeneral },
    { id: 'companions', label: t.tabCompanions },
    { id: 'profile', label: t.tabProfile },
    { id: 'lock', label: lang === 'fr' ? 'Verrouillage' : 'App lock' },
    { id: 'images', label: t.tabImages },
    { id: 'random', label: t.tabRandom },
    { id: 'comfy', label: t.tabComfy },
    { id: 'plugins', label: lang === 'fr' ? 'Plugins' : 'Plugins' },
    { id: 'llm', label: t.tabLLM },
    { id: 'update', label: t.tabUpdate },
    ...(currentUser?.isAdmin ? [
      { id: 'admin' as const, label: t.tabAdmin },
      { id: 'queue' as const, label: lang === 'fr' ? 'File' : 'Queue' },
      { id: 'logs' as const, label: t.tabLogs }
    ] : [])
  ];

  return (
    <div className="settings-modal-overlay" onClick={() => setShowSettings(false)}>
      <div ref={modalRef} className="settings-modal settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
        <header className="settings-header">
          <div>
            <h3 id="settings-title">{t.settings}</h3>
            <p>{t.settingsSubtitle}</p>
          </div>
          <button className="settings-close-btn" onClick={() => setShowSettings(false)} aria-label={t.close || 'Close'}>
            <XIcon size={19} />
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-tabs" aria-label={t.settings}>
            {settingsTabs.map(tab => (
              <button
                key={tab.id}
                ref={activeTab === tab.id ? activeTabButtonRef : undefined}
                type="button"
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
              >
                <SettingsTabIcon tab={tab.id} />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>

          <main className="tab-content">
          {activeTab === 'general' && (
            <div className="general-settings-stack">
              <section className={`clipboard-auto-card ${params.clipboardAutoGenerate ? 'active' : ''}`}>
                <div className="clipboard-auto-copy">
                  <span className="clipboard-auto-icon" aria-hidden="true"><ClipboardIcon size={24} /></span>
                  <div>
                    <h4>{t.clipboardAutoGenerateTitle}</h4>
                    <p>{t.clipboardAutoGenerateHelp}</p>
                  </div>
                </div>
                <label className={`clipboard-auto-toggle ${params.clipboardAutoGenerate ? 'active' : ''} ${isClipboardAutoGeneratePending ? 'pending' : ''}`}>
                  <input
                    type="checkbox"
                    checked={params.clipboardAutoGenerate}
                    disabled={isClipboardAutoGeneratePending || (!clipboardAutoGenerateSupported && !params.clipboardAutoGenerate)}
                    onChange={event => void onClipboardAutoGenerateChange(event.target.checked)}
                  />
                  <span>{isClipboardAutoGeneratePending
                    ? t.clipboardAutoGenerateEnabling
                    : params.clipboardAutoGenerate
                      ? t.clipboardAutoGenerateActive
                      : t.clipboardAutoGenerateEnable}</span>
                </label>
                {!clipboardAutoGenerateSupported && (
                  <p className="clipboard-auto-unavailable"><AlertTriangleIcon size={16} /> {t.clipboardAutoGenerateUnsupported}</p>
                )}
                <p className="clipboard-auto-warning"><AlertTriangleIcon size={16} /> {t.clipboardAutoGenerateWarning}</p>
              </section>

              <section className={`clipboard-auto-card ${params.civitaiMetadataOnDownload ? 'active' : ''}`}>
                <div className="clipboard-auto-copy">
                  <span className="clipboard-auto-icon" aria-hidden="true"><DownloadIcon size={24} /></span>
                  <div>
                    <h4>{civitaiMetadataText.title}</h4>
                    <p>{civitaiMetadataText.help}</p>
                  </div>
                </div>
                <label className={`clipboard-auto-toggle ${params.civitaiMetadataOnDownload ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={params.civitaiMetadataOnDownload}
                    onChange={event => setParams(current => ({
                      ...current,
                      civitaiMetadataOnDownload: event.target.checked,
                    }))}
                  />
                  <span>{params.civitaiMetadataOnDownload ? civitaiMetadataText.active : civitaiMetadataText.enable}</span>
                </label>
                <p className="clipboard-auto-warning"><AlertTriangleIcon size={16} /> {civitaiMetadataText.warning}</p>
              </section>

              <section className="companion-general-card">
                <div className="companion-general-copy">
                  <SeedyCompanion state="waiting" settings={{ ...companionSettings, enabled: true }} />
                  <div>
                    <h4>{t.companionTitle}</h4>
                    <p>{t.companionHelp}</p>
                  </div>
                </div>
                <div className="companion-general-actions">
                  <label className={`companion-enabled ${companionSettings.enabled ? 'active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={companionSettings.enabled}
                      onChange={event => setParams({
                        ...params,
                        companionSettings: { ...companionSettings, enabled: event.target.checked },
                      })}
                    />
                    <span>{t.companionEnabled}</span>
                  </label>
                  <button type="button" className="companion-customize-btn" onClick={() => setActiveTab('companions')}>
                    {t.customizeCompanion} →
                  </button>
                </div>
              </section>

              <section className="prompt-grouping-settings-card">
                <div className="prompt-grouping-settings-heading">
                  <div>
                    <h4>{t.promptGroupingSettingsTitle}</h4>
                    <p>{t.promptGroupingSettingsHelp}</p>
                  </div>
                  <div className="prompt-grouping-heading-status">
                    <span className={`settings-save-indicator ${settingsSaveState}`} role="status">
                      {settingsSaveState === 'saving' ? t.settingsSaving
                        : settingsSaveState === 'dirty' ? t.settingsUnsaved
                          : settingsSaveState === 'error' ? t.settingsSaveError
                            : t.settingsSavedIndicator}
                    </span>
                    <span className="prompt-grouping-settings-badge" aria-hidden="true">≈</span>
                  </div>
                </div>
                <div className="prompt-grouping-settings-controls">
                  <label className="lucky-slider">
                    <span className="lucky-slider-label">
                      <strong>{t.promptGroupingMinWords}</strong>
                      <output>{params.galleryPromptSimilarityMinWords}</output>
                    </span>
                    <input
                      type="range"
                      min="2"
                      max="200"
                      step="1"
                      value={params.galleryPromptSimilarityMinWords}
                      onChange={event => setParams({
                        ...params,
                        galleryPromptSimilarityMinWords: Number(event.target.value),
                      })}
                    />
                    <small>{t.promptGroupingMinWordsHelp}</small>
                  </label>
                  <label className="lucky-slider">
                    <span className="lucky-slider-label">
                      <strong>{t.promptGroupingSimilarity}</strong>
                      <output>{params.galleryPromptSimilarityThreshold}%</output>
                    </span>
                    <input
                      type="range"
                      min="50"
                      max="100"
                      step="1"
                      value={params.galleryPromptSimilarityThreshold}
                      onChange={event => setParams({
                        ...params,
                        galleryPromptSimilarityThreshold: Number(event.target.value),
                      })}
                    />
                    <small>{t.promptGroupingSimilarityHelp}</small>
                  </label>
                </div>
                <div className="prompt-grouping-rebuild">
                  <div className="prompt-grouping-rebuild-status" aria-live="polite">
                    <div className="prompt-grouping-progress-label">
                      <strong>{promptGroupRebuildStatus?.status === 'running'
                        ? t.promptGroupingRebuildRunning
                        : promptGroupRebuildStatus?.needsRebuild
                          ? t.promptGroupingRebuildNeeded
                          : t.promptGroupingRebuildReady}</strong>
                      <span>{promptGroupRebuildStatus?.percent || 0}%</span>
                    </div>
                    <div
                      className="prompt-grouping-progress-track"
                      role="progressbar"
                      aria-label={t.promptGroupingRebuildProgress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={promptGroupRebuildStatus?.percent || 0}
                    >
                      <span style={{ width: `${Math.min(100, Math.max(0, promptGroupRebuildStatus?.percent || 0))}%` }} />
                    </div>
                    <div className="prompt-grouping-progress-stats">
                      <span><strong>{promptGroupRebuildStatus?.processedPhotos || 0}</strong> / {promptGroupRebuildStatus?.totalPhotos || 0} {t.promptGroupingPhotos}</span>
                      <span><strong>{promptGroupRebuildStatus?.groupsFormed || 0}</strong> {t.promptGroupingGroupsFormed}</span>
                      <span><strong>{promptGroupRebuildStatus?.manualGroupsPreserved || 0}</strong> {t.promptGroupingManualPreserved}</span>
                    </div>
                    {promptGroupRebuildStatus?.status === 'error' && (
                      <small className="prompt-grouping-rebuild-error">{promptGroupRebuildStatus.error || t.promptGroupingRebuildFailed}</small>
                    )}
                  </div>
                  <button
                    type="button"
                    className="prompt-grouping-rebuild-btn"
                    onClick={() => void startPromptGroupRebuild()}
                    disabled={isStartingPromptGroupRebuild || promptGroupRebuildStatus?.status === 'running'}
                  >
                    <RefreshIcon size={17} />
                    {isStartingPromptGroupRebuild
                      ? t.settingsSaving
                      : promptGroupRebuildStatus?.status === 'running'
                        ? t.promptGroupingRebuildRunning
                        : t.promptGroupingRebuildAction}
                  </button>
                </div>
                <small className="prompt-grouping-manual-note"><CheckCircleIcon size={15} /> {t.promptGroupingManualSafety}</small>
              </section>

              <section className="lucky-settings-card">
                <div className="lucky-settings-heading">
                  <div>
                    <h4>{t.luckySettingsTitle}</h4>
                    <p>{t.luckySettingsHelp}</p>
                  </div>
                  <span className="lucky-settings-badge" aria-hidden="true"><SparklesIcon size={21} /></span>
                </div>
                <div className="lucky-settings-controls">
                  <label className="lucky-slider">
                    <span className="lucky-slider-label">
                      <strong>{t.luckyTemperature}</strong>
                      <output>{params.luckyTemperature.toFixed(2)}</output>
                    </span>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={params.luckyTemperature}
                      onChange={event => setParams({
                        ...params,
                        luckyTemperature: Number(event.target.value),
                      })}
                    />
                    <small>{t.luckyTemperatureHelp}</small>
                  </label>
                  <label className="lucky-slider">
                    <span className="lucky-slider-label">
                      <strong>{t.luckyFavoriteCount}</strong>
                      <output>{params.luckyFavoriteCount}</output>
                    </span>
                    <input
                      type="range"
                      min="2"
                      max="8"
                      step="1"
                      value={params.luckyFavoriteCount}
                      onChange={event => setParams({
                        ...params,
                        luckyFavoriteCount: Number(event.target.value),
                      })}
                    />
                    <small>{t.luckyFavoriteCountHelp}</small>
                  </label>
                </div>
              </section>

              <section className="llm-memory-card">
                <div className="llm-memory-heading">
                  <span className="llm-memory-icon" aria-hidden="true">RAM</span>
                  <div>
                    <h4>{t.llmMemoryTitle}</h4>
                    <p>{t.llmMemoryHelp}</p>
                  </div>
                </div>
                <div className="llm-memory-status">
                  {params.llmProviderId && <span>{t.llmMemoryTextBadge}</span>}
                  {params.visionProviderId && params.visionModel && <span>{t.llmMemoryVisionBadge}</span>}
                </div>
                <button
                  type="button"
                  className="llm-memory-release-btn"
                  onClick={() => void unloadLlmMemory()}
                  disabled={isUnloadingLlm || (!params.llmProviderId && !params.visionProviderId)}
                >
                  {isUnloadingLlm ? t.llmMemoryReleasing : t.llmMemoryReleaseAction}
                </button>
              </section>

              <section className="llm-memory-card comfy-memory-card">
                <div className="llm-memory-heading">
                  <span className="llm-memory-icon comfy-memory-icon" aria-hidden="true">GPU</span>
                  <div>
                    <h4>{t.comfyMemoryTitle}</h4>
                    <p>{t.comfyMemoryHelp}</p>
                  </div>
                </div>
                <div className="llm-memory-status">
                  <span>{t.comfyMemoryBadge}</span>
                </div>
                <button
                  type="button"
                  className="llm-memory-release-btn"
                  onClick={() => void freeComfyMemory()}
                  disabled={isFreeingComfyMemory}
                >
                  {isFreeingComfyMemory ? t.comfyMemoryReleasing : t.comfyMemoryReleaseAction}
                </button>
              </section>

              <section className="thumbnail-cache-card">
                <div className="thumbnail-cache-heading">
                  <span className="thumbnail-cache-icon" aria-hidden="true"><RefreshIcon size={22} /></span>
                  <div>
                    <h4>{t.thumbnailCacheTitle}</h4>
                    <p>{t.thumbnailCacheHelp}</p>
                  </div>
                </div>
                <div className="thumbnail-cache-actions">
                  {thumbnailCacheStats && (
                    <span className="thumbnail-cache-size" aria-live="polite">
                      {new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US').format(thumbnailCacheStats.fileCount)} {t.thumbnailCacheFiles}
                      {' · '}{formatBytes(thumbnailCacheStats.totalBytes)}
                    </span>
                  )}
                  <button
                    type="button"
                    className="thumbnail-cache-purge-btn"
                    onClick={() => void inspectThumbnailCache()}
                    disabled={isInspectingThumbnailCache || isPurgingThumbnailCache}
                  >
                    <TrashIcon size={17} />
                    {isInspectingThumbnailCache ? t.thumbnailCacheInspecting : t.thumbnailCachePurgeAction}
                  </button>
                </div>
              </section>

              <section className="session-management-card">
                <div className="session-management-heading">
                  <h4>{t.sessionManagementTitle}</h4>
                  <p>{t.sessionManagementHelp}</p>
                </div>
                <div className="session-management-actions">
                  <button type="button" className="session-action-card archive" onClick={requestArchiveAll}>
                    <span className="session-action-icon"><SessionActionIcon type="archive" /></span>
                    <span className="session-action-copy">
                      <strong>{t.archiveAll}</strong>
                      <small>{t.archiveAllHelp}</small>
                    </span>
                    <span className="session-action-arrow" aria-hidden="true">→</span>
                  </button>
                  <button type="button" className="session-action-card delete" onClick={requestDeleteAll}>
                    <span className="session-action-icon"><SessionActionIcon type="delete" /></span>
                    <span className="session-action-copy">
                      <strong>{t.deleteAll}</strong>
                      <small>{t.deleteAllHelp}</small>
                    </span>
                    <span className="session-action-arrow" aria-hidden="true">→</span>
                  </button>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'companions' && (
            <section className="companion-settings">
              <div className="companion-settings-header">
                <div>
                  <h4>{t.companionLibraryTitle}</h4>
                  <p>{t.companionLibraryHelp}</p>
                </div>
              </div>
              <div className="companion-toolbar">
                <div>
                  <strong>{t.chooseCompanion}</strong>
                  <small>{t.companionGridHelp}</small>
                </div>
                <button type="button" className="companion-import-btn" onClick={() => companionFileInputRef.current?.click()}>
                  + {t.importCompanion}
                </button>
                <input
                  ref={companionFileInputRef}
                  type="file"
                  accept="image/webp,image/png"
                  hidden
                  onChange={importCompanion}
                />
              </div>

              <div className="companion-grid">
                {companionSettings.companions.map(companion => {
                  const previewSettings = {
                    ...companionSettings,
                    enabled: true,
                    activeId: companion.id,
                  };
                  const isActive = companionSettings.activeId === companion.id;
                  return (
                    <article
                      key={companion.id}
                      className={`companion-card ${isActive ? 'active' : ''}`}
                      onClick={() => selectCompanion(companion.id)}
                    >
                      <div className="companion-preview">
                        <SeedyCompanion state="working" settings={previewSettings} />
                      </div>
                      <div className="companion-card-body">
                        <input
                          value={companion.name}
                          onClick={event => event.stopPropagation()}
                          onChange={event => updateCompanionName(companion.id, event.target.value)}
                          onBlur={event => {
                            if (!event.target.value.trim()) updateCompanionName(companion.id, t.newCompanion);
                          }}
                          aria-label={t.companionName}
                        />
                        <small>{companion.source === 'builtin' ? t.builtinCompanion : companion.fileName}</small>
                      </div>
                      <span className="companion-selected-mark" aria-hidden="true">{isActive && <CheckIcon size={16} />}</span>
                      {companion.source === 'custom' && (
                        <button
                          type="button"
                          className="companion-delete-btn"
                          onClick={event => {
                            event.stopPropagation();
                            removeCompanion(companion.id);
                          }}
                          title={t.delete}
                          aria-label={`${t.delete}: ${companion.name}`}
                        >
                          ×
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {activeTab === 'random' && (
            <section className="random-lists-settings">
              <div className="random-lists-intro">
                <div>
                  <h4>{t.randomListsTitle}</h4>
                  <p>{t.randomListsHelp}</p>
                </div>
                <button type="button" className="random-list-add" onClick={addRandomList}>+ {t.addRandomList}</button>
              </div>

              <div className="random-list-stack">
                {params.randomPromptLists.map(list => {
                  const duplicateSlug = params.randomPromptLists.some(other => other.id !== list.id && other.slug.toLowerCase() === list.slug.toLowerCase());
                  return (
                    <article className="random-list-card" key={list.id}>
                      <div className="random-list-card-header">
                        <input
                          className="random-list-name"
                          value={list.name}
                          onChange={event => updateRandomList(list.id, { name: event.target.value })}
                          aria-label={t.listName}
                          placeholder={t.listName}
                        />
                        <label className="random-list-enabled">
                          <input type="checkbox" checked={list.enabled} onChange={event => updateRandomList(list.id, { enabled: event.target.checked })} />
                          <span>{t.active}</span>
                        </label>
                        <button type="button" className="random-list-delete" onClick={() => removeRandomList(list.id)} title={t.delete}>×</button>
                      </div>
                      <div className="random-list-fields">
                        <label>
                          <span>{t.randomSlug}</span>
                          <div className={`random-slug-input ${duplicateSlug ? 'invalid' : ''}`}>
                            <span>[</span>
                            <input
                              value={list.slug}
                              onChange={event => updateRandomList(list.id, { slug: normalizeRandomSlug(event.target.value) })}
                              placeholder="R-Color"
                            />
                            <span>]</span>
                          </div>
                          {duplicateSlug && <small>{t.duplicateSlug}</small>}
                        </label>
                        <label>
                          <span>{t.randomValues}</span>
                          <textarea
                            rows={6}
                            value={list.values.join('\n')}
                            onChange={event => updateRandomList(list.id, { values: event.target.value.split(/\r?\n/) })}
                            placeholder={t.randomValuesPlaceholder}
                          />
                          <small>{list.values.filter(value => value.trim()).length} {t.values}</small>
                        </label>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {activeTab === 'profile' && (
            <div className="profile-edit-section">
              <section className="avatar-edit-container">
                <button type="button" className="avatar-preview-wrapper" onClick={openAvatarPicker} aria-label={t.changeAvatar}>
                  {currentUser?.avatarUrl ? (
                    <img src={getFullImageUrl(getAvatarThumbnailUrl(currentUser.avatarUrl))} alt="Avatar" className="avatar-preview-img" />
                  ) : (
                    <div className="avatar-preview-initial">{userInitial}</div>
                  )}
                  <span className="avatar-edit-badge" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
                    </svg>
                  </span>
                </button>
                <div className="avatar-editor-content">
                  <div>
                    <strong>{t.profilePhoto}</strong>
                    <p>{t.profilePhotoHelp}</p>
                  </div>
                  <div className="avatar-editor-actions">
                    <button type="button" className="change-avatar-btn" onClick={openAvatarPicker}>
                      {t.changeAvatar}
                    </button>
                    {currentUser?.avatarUrl && (
                      <button type="button" className="remove-avatar-btn" onClick={handleRemoveAvatar}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 7h16m-10 4v5m4-5v5M9 7l1-3h4l1 3m3 0-1 13H7L6 7" />
                        </svg>
                        {t.deleteAvatar}
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <div className="settings-grid">
                <div className="setting-item" style={{ gridColumn: 'span 2' }}>
                  <label>{t.username}</label>
                  <input type="text" value={editUsername} onChange={(e) => setEditUsername(e.target.value)} />
                </div>
                <div className="setting-item">
                  <label>{t.newPassword}</label>
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <div className="setting-item">
                  <label>{t.confirmPassword}</label>
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <div className="setting-item" style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
                  <button className="action-btn-large" onClick={handleUpdateProfile} disabled={isUpdating}>
                    {isUpdating ? '...' : t.save}
                  </button>
                </div>
              </div>

              {showImagePicker && (
                <div className="image-picker-overlay" onClick={() => setShowImagePicker(false)}>
                  <div className="image-picker-container" onClick={(e) => e.stopPropagation()}>
                    <div className="image-picker-header">
                      <h4>{t.selectFromLibrary}</h4>
                      <button className="picker-close" onClick={() => setShowImagePicker(false)}>×</button>
                    </div>
                    <div className="picker-grid">
                      {sortedGallery.length > 0 ? (
                        sortedGallery.map((item) => (
                          <div 
                            key={item.messageId} 
                            className={`picker-item ${item.isFavorite ? 'favorite' : ''}`}
                            onClick={() => handleSelectAvatar(item.imageUrl)}
                          >
                            <img src={getFullImageUrl(item.thumbnailUrl || item.imageUrl)} alt="Option" />
                            {item.isFavorite === 1 && <span className="picker-favorite-badge"><HeartIcon size={16} filled /></span>}
                          </div>
                        ))
                      ) : (
                        <p className="empty-picker">{t.noArchives}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'lock' && (
            <AppLockSettings
              config={appLockConfig}
              lang={lang}
              onConfigChange={onAppLockConfigChange}
              onLockNow={() => {
                setShowSettings(false);
                onAppLockNow();
              }}
            />
          )}

          {activeTab === 'images' && (
            <>
              <div className="settings-row-2">
                <div className="setting-item">
                  <label>{t.width}</label>
                  <div className="parameter-with-reset">
                    <input type="number" value={params.width} onChange={(e) => setParams({ ...params, width: Number(e.target.value) })} step={64} />
                    {activeDefaults?.width !== undefined && (
                      <button type="button" onClick={() => resetModelParameter('width')} disabled={params.width === activeDefaults.width} title={`${t.resetToModelDefault}: ${activeDefaults.width}`}>↺</button>
                    )}
                  </div>
                  {activeDefaults?.width !== undefined && params.width !== activeDefaults.width && (
                    <small className="parameter-default-hint">{t.defaultValue}: {activeDefaults.width}</small>
                  )}
                </div>
                <div className="setting-item">
                  <label>{t.height}</label>
                  <div className="parameter-with-reset">
                    <input type="number" value={params.height} onChange={(e) => setParams({ ...params, height: Number(e.target.value) })} step={64} />
                    {activeDefaults?.height !== undefined && (
                      <button type="button" onClick={() => resetModelParameter('height')} disabled={params.height === activeDefaults.height} title={`${t.resetToModelDefault}: ${activeDefaults.height}`}>↺</button>
                    )}
                  </div>
                  {activeDefaults?.height !== undefined && params.height !== activeDefaults.height && (
                    <small className="parameter-default-hint">{t.defaultValue}: {activeDefaults.height}</small>
                  )}
                </div>
              </div>
              <div className="format-presets">
                <button className={`preset-btn ${params.width === 1024 && params.height === 1024 ? 'active' : ''}`} onClick={() => setParams({ ...params, width: 1024, height: 1024 })}>1:1 {t.square}</button>
                <button className={`preset-btn ${params.width === 1216 && params.height === 832 ? 'active' : ''}`} onClick={() => setParams({ ...params, width: 1216, height: 832 })}>3:2 {t.landscape}</button>
                <button className={`preset-btn ${params.width === 896 && params.height === 1152 ? 'active' : ''}`} onClick={() => setParams({ ...params, width: 896, height: 1152 })}>2:3 {t.portrait}</button>
              </div>
              <div className="settings-row-2" style={{ marginTop: '1.5rem' }}>
                <div className="setting-item">
                  <label>{t.steps}</label>
                  <div className="parameter-with-reset">
                    <input type="number" value={params.steps} onChange={(e) => setParams({ ...params, steps: Number(e.target.value) })} min={1} max={50} />
                    {activeDefaults?.steps !== undefined && (
                      <button type="button" onClick={() => resetModelParameter('steps')} disabled={params.steps === activeDefaults.steps} title={`${t.resetToModelDefault}: ${activeDefaults.steps}`}>↺</button>
                    )}
                  </div>
                  {activeDefaults?.steps !== undefined && params.steps !== activeDefaults.steps && (
                    <small className="parameter-default-hint">{t.defaultValue}: {activeDefaults.steps}</small>
                  )}
                </div>
                <div className="setting-item">
                  <label>{t.cfg}</label>
                  <div className="parameter-with-reset">
                    <input type="number" value={params.cfg} onChange={(e) => setParams({ ...params, cfg: Number(e.target.value) })} step={0.1} min={0} max={20} />
                    {activeDefaults?.cfg !== undefined && (
                      <button type="button" onClick={() => resetModelParameter('cfg')} disabled={params.cfg === activeDefaults.cfg} title={`${t.resetToModelDefault}: ${activeDefaults.cfg}`}>↺</button>
                    )}
                  </div>
                  {activeDefaults?.cfg !== undefined && params.cfg !== activeDefaults.cfg && (
                    <small className="parameter-default-hint">{t.defaultValue}: {activeDefaults.cfg}</small>
                  )}
                </div>
              </div>
              <div className="settings-row-2" style={{ marginTop: '1.5rem' }}>
                <div className="setting-item">
                  <label>{t.sampler}</label>
                  <div className="parameter-with-reset">
                    <select value={params.sampler || 'euler'} onChange={(e) => setParams({ ...params, sampler: e.target.value })}>
                      <option value="euler">euler</option>
                      <option value="euler_ancestral">euler_ancestral</option>
                      <option value="heun">heun</option>
                      <option value="heunpp2">heunpp2</option>
                      <option value="dpm_2">dpm_2</option>
                      <option value="dpm_2_ancestral">dpm_2_ancestral</option>
                      <option value="lms">lms</option>
                      <option value="dpm_fast">dpm_fast</option>
                      <option value="dpm_adaptive">dpm_adaptive</option>
                      <option value="dpmpp_2s_ancestral">dpmpp_2s_ancestral</option>
                      <option value="dpmpp_sde">dpmpp_sde</option>
                      <option value="dpmpp_sde_gpu">dpmpp_sde_gpu</option>
                      <option value="dpmpp_2m">dpmpp_2m</option>
                      <option value="dpmpp_2m_sde">dpmpp_2m_sde</option>
                      <option value="dpmpp_2m_sde_gpu">dpmpp_2m_sde_gpu</option>
                      <option value="dpmpp_3m_sde">dpmpp_3m_sde</option>
                      <option value="dpmpp_3m_sde_gpu">dpmpp_3m_sde_gpu</option>
                      <option value="ddpm">ddpm</option>
                      <option value="lcm">lcm</option>
                      <option value="ddim">ddim</option>
                      <option value="uni_pc">uni_pc</option>
                      <option value="uni_pc_bh2">uni_pc_bh2</option>
                    </select>
                    {activeDefaults?.sampler !== undefined && (
                      <button type="button" onClick={() => resetModelParameter('sampler')} disabled={params.sampler === activeDefaults.sampler} title={`${t.resetToModelDefault}: ${activeDefaults.sampler}`}>↺</button>
                    )}
                  </div>
                  {activeDefaults?.sampler !== undefined && params.sampler !== activeDefaults.sampler && (
                    <small className="parameter-default-hint">{t.defaultValue}: {activeDefaults.sampler}</small>
                  )}
                </div>
                <div className="setting-item">
                  <label>{t.scheduler}</label>
                  <div className="parameter-with-reset">
                    <select value={params.scheduler || 'normal'} onChange={(e) => setParams({ ...params, scheduler: e.target.value })}>
                      <option value="normal">normal</option>
                      <option value="karras">karras</option>
                      <option value="exponential">exponential</option>
                      <option value="sgm_uniform">sgm_uniform</option>
                      <option value="simple">simple</option>
                      <option value="ddim_uniform">ddim_uniform</option>
                      <option value="beta">beta</option>
                    </select>
                    {activeDefaults?.scheduler !== undefined && (
                      <button type="button" onClick={() => resetModelParameter('scheduler')} disabled={params.scheduler === activeDefaults.scheduler} title={`${t.resetToModelDefault}: ${activeDefaults.scheduler}`}>↺</button>
                    )}
                  </div>
                  {activeDefaults?.scheduler !== undefined && params.scheduler !== activeDefaults.scheduler && (
                    <small className="parameter-default-hint">{t.defaultValue}: {activeDefaults.scheduler}</small>
                  )}
                </div>
              </div>
              <div className="settings-grid" style={{ marginTop: '1.5rem' }}>
                <div className="setting-item" style={{ gridColumn: 'span 2' }}>
                  <label>{t.negativePrompt}</label>
                  <textarea 
                    className="system-message-textarea" 
                    value={localNegativePrompt} 
                    onChange={(e) => setLocalNegativePrompt(e.target.value)} 
                    rows={3} 
                  />
                  <button 
                    className="action-btn-small" 
                    onClick={() => handleSaveTextarea('negativePrompt')}
                    disabled={localNegativePrompt === params.negativePrompt}
                    style={{ marginTop: '0.5rem', alignSelf: 'flex-start' }}
                  >
                    {t.save}
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'comfy' && (
            <div className="settings-grid">
              <div className="setting-item" style={{ gridColumn: 'span 2' }}>
                <label>{t.comfyUrl}</label>
                <div className="model-select-group">
                  <input 
                    type="text" 
                    value={params.comfyUrl} 
                    onChange={(e) => setParams({ ...params, comfyUrl: e.target.value })} 
                    placeholder="http://127.0.0.1:8188" 
                    style={{ flex: 1 }}
                  />
                  <button
                    className="refresh-models-btn test-conn-btn"
                    onClick={testComfyConnection}
                    disabled={isCheckingComfy || !params.comfyUrl}
                    title={t.testConnection}
                  >
                    {isCheckingComfy ? '...' : t.testConnection}
                  </button>
                </div>
                {comfyCheckStatus && <p className={`llm-status-msg ${comfyCheckStatus.type}`}>{comfyCheckStatus.msg}</p>}
              </div>
              <div className="setting-item" style={{ gridColumn: 'span 2' }}>
                <label>{t.checkpointModel}</label>
                <div className="favorite-model-library">
                  <div className="favorite-model-library-header">
                    <div>
                      <strong><StarIcon size={16} filled /> {t.favoriteModels}</strong>
                      <span>{t.favoriteModelsHelp}</span>
                    </div>
                    <span className="favorite-count">{favoriteModels.length}</span>
                  </div>
                  {favoriteModels.length > 0 ? (
                    <div className="favorite-model-list">
                      {favoriteModels.map((favorite) => {
                        const isActive = params.comfyModel === favorite.model
                          && params.comfyModelType === (favorite.modelType || 'checkpoint');
                        return (
                        <div
                          key={`${favorite.modelType || 'checkpoint'}:${favorite.model}`}
                          className={`favorite-model-card ${isActive ? 'active' : ''}`}
                        >
                          <button
                            type="button"
                            className="favorite-model-select"
                            onClick={() => selectFavoriteModel(favorite.model, favorite.workflowFile, favorite.modelType || 'checkpoint')}
                            title={favorite.model}
                            aria-pressed={isActive}
                          >
                            <span className="favorite-model-name">{getModelDisplayName(favorite.model)}</span>
                            <span className="favorite-model-path">
                              {[
                                favorite.modelType === 'diffusion' ? t.diffusionModels : t.checkpoints,
                                favorite.model,
                                formatModelSize((favorite.modelType === 'diffusion' ? diffusionDetailsByName : checkpointDetailsByName).get(favorite.model))
                              ].filter(Boolean).join(' · ')}
                            </span>
                          </button>
                          <div className="favorite-workflow-editor">
                            <label htmlFor={`workflow-${favorite.model}`}>{t.associatedWorkflow}</label>
                            <select
                              id={`workflow-${favorite.model}`}
                              value={favorite.workflowFile}
                              onChange={(e) => updateFavoriteWorkflow(favorite.model, favorite.modelType || 'checkpoint', e.target.value)}
                            >
                              <option value="">{t.noWorkflowAssigned}</option>
                              {favorite.workflowFile && !availableWorkflows.includes(favorite.workflowFile) && (
                                <option value={favorite.workflowFile}>{favorite.workflowFile}</option>
                              )}
                              {availableWorkflows.map(workflow => (
                                <option key={workflow} value={workflow}>{workflow}</option>
                              ))}
                            </select>
                          </div>
                          {favorite.generationDefaults && (
                            <div className="favorite-model-defaults" title={t.defaultsFromWorkflow}>
                              <span>{favorite.generationDefaults.width ?? '—'} × {favorite.generationDefaults.height ?? '—'}</span>
                              <span>{favorite.generationDefaults.steps ?? '—'} {t.steps.toLowerCase()}</span>
                              <span>CFG {favorite.generationDefaults.cfg ?? '—'}</span>
                              <span>{favorite.generationDefaults.sampler ?? '—'}</span>
                              <span>{favorite.generationDefaults.scheduler ?? '—'}</span>
                            </div>
                          )}
                          <button
                            type="button"
                            className="favorite-model-activate"
                            onClick={() => selectFavoriteModel(favorite.model, favorite.workflowFile, favorite.modelType || 'checkpoint')}
                            disabled={isActive}
                            aria-pressed={isActive}
                          >
                            {isActive && <CheckIcon size={16} />}
                            {isActive ? t.modelActive : t.activateModel}
                          </button>
                          <button
                            type="button"
                            className="favorite-model-remove"
                            onClick={() => toggleFavoriteModel(favorite.model, favorite.modelType || 'checkpoint')}
                            title={t.removeFromFavorites}
                            aria-label={`${t.removeFromFavorites}: ${favorite.model}`}
                          >
                            <StarIcon size={18} filled />
                          </button>
                        </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="favorite-model-empty">{t.noFavoriteModels}</p>
                  )}
                </div>
                <div className="model-type-toggle" role="group" aria-label={t.modelType}>
                  <button
                    type="button"
                    className={params.comfyModelType === 'checkpoint' ? 'active' : ''}
                    onClick={() => switchModelType('checkpoint')}
                  >
                    {t.checkpoints} <span>{comfyModels.length}</span>
                  </button>
                  <button
                    type="button"
                    className={params.comfyModelType === 'diffusion' ? 'active' : ''}
                    onClick={() => switchModelType('diffusion')}
                  >
                    {t.diffusionModels} <span>{diffusionModels.length}</span>
                  </button>
                </div>
                <div style={{ marginBottom: '0.8rem' }}>
                  <input 
                    type="text" 
                    placeholder={t.searchModel}
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    style={{ 
                      width: '100%', 
                      background: 'rgba(255,255,255,0.05)', 
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '0.6rem 1rem',
                      fontSize: '0.9rem'
                    }}
                  />
                </div>
                <div className="model-browser">
                  <div className="model-browser-toolbar">
                    <span>{filteredModels.length} {t.modelsFound}</span>
                  <button
                    className="refresh-models-btn"
                    onClick={fetchComfyModels}
                    disabled={isFetchingComfyModels || !params.comfyUrl}
                    title={t.refreshModels}
                  >
                    {isFetchingComfyModels ? '...' : <RefreshIcon size={16} />}
                  </button>
                  </div>
                  <div className="model-browser-list">
                    {filteredModels.length > 0 ? filteredModels.map(model => {
                      const isFavorite = favoriteModels.some(item => item.model === model && (item.modelType || 'checkpoint') === params.comfyModelType);
                      const isSelected = params.comfyModel === model;
                      return (
                        <div key={model} className={`model-browser-row ${isSelected ? 'selected' : ''}`}>
                          <button
                            type="button"
                            className="model-browser-select"
                            onClick={() => {
                              const favorite = favoriteModels.find(item => item.model === model && (item.modelType || 'checkpoint') === params.comfyModelType);
                              selectFavoriteModel(model, favorite?.workflowFile, params.comfyModelType);
                            }}
                            title={model}
                          >
                            <span>{getModelDisplayName(model)}</span>
                            <small>{[model, formatModelSize(modelDetailsByName.get(model))].filter(Boolean).join(' · ')}</small>
                          </button>
                          <button
                            type="button"
                            className={`model-favorite-toggle ${isFavorite ? 'active' : ''}`}
                            onClick={() => toggleFavoriteModel(model, params.comfyModelType)}
                            title={isFavorite ? t.removeFromFavorites : t.addToFavorites}
                            aria-label={`${isFavorite ? t.removeFromFavorites : t.addToFavorites}: ${model}`}
                          >
                            <StarIcon size={18} filled={isFavorite} />
                          </button>
                        </div>
                      );
                    }) : <p className="model-browser-empty">{t.noModelsFound}</p>}
                  </div>
                </div>
                {comfyStatus && <p className={`llm-status-msg ${comfyStatus.type}`}>{comfyStatus.msg}</p>}
              </div>
              <div className="setting-item" style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                <label>{t.workflowFile}</label>
                <select
                  value={params.workflowFile}
                  onChange={(e) => setParams({ ...params, workflowFile: e.target.value })}
                  className="model-select"
                >
                  {availableWorkflows.length > 0 ? (
                    availableWorkflows.map(wf => <option key={wf} value={wf}>{wf}</option>)
                  ) : (
                    <option value={params.workflowFile}>{params.workflowFile}</option>
                  )}
                </select>
                {currentUser?.isAdmin && (
                  <div className="workflow-manager">
                    <div className="workflow-manager-header">
                      <div>
                        <strong>{t.apiWorkflows}</strong>
                        <span>{t.apiWorkflowHelp}</span>
                      </div>
                      <button
                        type="button"
                        className="workflow-import-btn"
                        onClick={() => { setWorkflowToReplace(null); workflowFileInputRef.current?.click(); }}
                        disabled={isImportingWorkflow}
                      >
                        {isImportingWorkflow ? '…' : `＋ ${t.importWorkflow}`}
                      </button>
                      <input
                        ref={workflowFileInputRef}
                        type="file"
                        accept="application/json,.json"
                        hidden
                        onChange={(event) => handleImportWorkflow(event.target.files?.[0])}
                      />
                    </div>
                    <div className="workflow-manager-list">
                      {availableWorkflows.map(workflow => (
                        <div key={workflow} className={params.workflowFile === workflow ? 'active' : ''}>
                          <button type="button" onClick={() => setParams({ ...params, workflowFile: workflow })}>
                            <span>{workflow}</span>
                            <small>{params.workflowFile === workflow ? t.active : t.apiWorkflow}</small>
                          </button>
                          <button
                            type="button"
                            className="workflow-replace-btn"
                            onClick={() => { setWorkflowToReplace(workflow); workflowFileInputRef.current?.click(); }}
                            title={t.replaceWorkflowHelp}
                          >
                            ↻
                          </button>
                          <button
                            type="button"
                            className="workflow-delete-btn"
                            onClick={() => handleDeleteWorkflow(workflow)}
                            title={t.delete}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    {workflowMapping && (
                      <div className="workflow-mapping-panel">
                        <div className="workflow-mapping-title">
                          <div>
                            <strong>{t.workflowMapping}</strong>
                            <span>{t.workflowMappingHelp}</span>
                          </div>
                          <div className="mapping-health">
                            <span className={(mappingDraft.checkpoint || mappingDraft.diffusionModel) ? 'ok' : 'missing'}>{t.model}</span>
                            <span className={mappingDraft.positive ? 'ok' : 'missing'}>{t.positivePrompt}</span>
                            <span className={mappingDraft.latent ? 'ok' : 'missing'}>{t.dimensions}</span>
                            <span className={mappingDraft.ksampler ? 'ok' : 'missing'}>{t.sampler} ×{workflowMapping.samplerCount || 0}</span>
                            <span className={mappingDraft.save ? 'ok' : 'missing'}>{t.outputNode}</span>
                          </div>
                        </div>
                        <div className="workflow-mapping-grid">
                          {workflowMappingKeys.map(key => (
                            <label key={key}>
                              <span>{t[`mapping_${key}`] || key}</span>
                              <select
                                value={mappingDraft[key] || ''}
                                onChange={(event) => setMappingDraft(current => ({ ...current, [key]: event.target.value }))}
                              >
                                <option value="">{t.notMapped}</option>
                                {workflowMapping.nodes.map(node => (
                                  <option key={node.id} value={node.id}>
                                    {node.id} · {node.title} ({node.classType})
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="mapping-save-btn"
                          onClick={handleSaveWorkflowMapping}
                          disabled={isSavingMapping}
                        >
                          {isSavingMapping ? '…' : t.saveMapping}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Legacy inline Civitai panel retained here only as source history.
          {activeTab === 'plugins' && (
            <div className="plugins-settings-stack">
              <section className="plugin-card civitai-plugin-card">
                <header className="plugin-card-header">
                  <div className="plugin-brand">
                    <span className="plugin-brand-mark" aria-hidden="true">C</span>
                    <div>
                      <span className="plugin-eyebrow">Civitai</span>
                      <h4>{lang === 'fr' ? 'Association des modèles' : 'Model linking'}</h4>
                      <p>{lang === 'fr'
                        ? 'Relie les modèles locaux à leur version Civitai pour intégrer automatiquement le hash et la ressource aux images.'
                        : 'Links local models to their Civitai version so hashes and resources are embedded automatically.'}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="civitai-add-button"
                    onClick={() => {
                      const initial = allLocalModels.find(local => !civitaiModelLinks.some(link => link.localModel === local.model && link.modelType === local.modelType)) || allLocalModels[0];
                      if (initial) {
                        setCivitaiLocalModel(initial.model);
                        setCivitaiLocalModelType(initial.modelType);
                      }
                      setCivitaiCandidates([]);
                      setShowCivitaiLinker(true);
                    }}
                    disabled={!allLocalModels.length}
                    title={lang === 'fr' ? 'Ajouter un modèle à lier' : 'Add a model link'}
                    aria-label={lang === 'fr' ? 'Ajouter un modèle à lier' : 'Add a model link'}
                  >
                    <PlusIcon size={20} />
                  </button>
                </header>

                <div className="civitai-sync-summary">
                  <div>
                    <strong>{civitaiModelLinks.length}</strong>
                    <span>{lang === 'fr' ? 'modèle(s) associé(s)' : 'linked model(s)'}</span>
                  </div>
                  <button type="button" className="civitai-sync-button" disabled={isSyncingCivitai || !favoriteModels.length} onClick={() => void syncFavoriteModelsWithCivitai()}>
                    {isSyncingCivitai ? <RefreshIcon size={17} /> : <><RefreshIcon size={17} /> {lang === 'fr' ? 'Associer à Civitai' : 'Link with Civitai'}</>}
                  </button>
                </div>
                <p className="civitai-sync-help">{lang === 'fr'
                  ? 'Analyse uniquement les modèles favoris. Une correspondance n’est validée automatiquement que si le nom du fichier ou le nom modèle/version correspond exactement.'
                  : 'Scans favorite models only. A match is accepted automatically only when the filename or model/version name matches exactly.'}</p>

                {showCivitaiLinker && (
                  <div className="civitai-linker">
                    <div className="civitai-linker-title">
                      <strong>{lang === 'fr' ? 'Lier un modèle' : 'Link a model'}</strong>
                      <button type="button" onClick={() => { setShowCivitaiLinker(false); setCivitaiCandidates([]); }} aria-label={t.close || 'Close'}><XIcon size={17} /></button>
                    </div>
                    <div className="civitai-linker-fields">
                      <label>
                        <span>{lang === 'fr' ? 'Modèle local' : 'Local model'}</span>
                        <select
                          value={`${civitaiLocalModelType}:${civitaiLocalModel}`}
                          onChange={event => {
                            const separator = event.target.value.indexOf(':');
                            setCivitaiLocalModelType(event.target.value.slice(0, separator) as 'checkpoint' | 'diffusion');
                            setCivitaiLocalModel(event.target.value.slice(separator + 1));
                            setCivitaiCandidates([]);
                          }}
                        >
                          {allLocalModels.map(local => <option key={`${local.modelType}:${local.model}`} value={`${local.modelType}:${local.model}`}>{local.model}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>{lang === 'fr' ? 'Recherche intelligente' : 'Smart search'}</span>
                        <div className="civitai-inline-field">
                          <input value={civitaiQuery} onChange={event => setCivitaiQuery(event.target.value)} placeholder={civitaiLocalModel.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')} />
                          <button type="button" disabled={isSearchingCivitai || !civitaiLocalModel} onClick={() => void requestCivitaiCandidates(civitaiLocalModel, civitaiLocalModelType, civitaiQuery)}>
                            {isSearchingCivitai ? '…' : (lang === 'fr' ? 'Rechercher' : 'Search')}
                          </button>
                        </div>
                      </label>
                    </div>
                    <div className="civitai-version-field">
                      <span>{lang === 'fr' ? 'Ou coller une URL / un ID de version' : 'Or paste a version URL / ID'}</span>
                      <div className="civitai-inline-field">
                        <input value={civitaiVersionInput} onChange={event => setCivitaiVersionInput(event.target.value)} placeholder="https://civitai.com/models/…?modelVersionId=…" />
                        <button type="button" disabled={isSearchingCivitai || !civitaiVersionInput.trim()} onClick={() => void resolveCivitaiVersionInput()}>{lang === 'fr' ? 'Associer' : 'Link'}</button>
                      </div>
                    </div>
                    {civitaiCandidates.length > 0 && (
                      <div className="civitai-candidate-list">
                        {civitaiCandidates.map(candidate => (
                          <button key={`${candidate.modelVersionId}:${candidate.fileName}`} type="button" onClick={() => {
                            saveCivitaiLink(candidate);
                            toast.success(lang === 'fr' ? 'Modèle associé à Civitai' : 'Model linked to Civitai');
                          }}>
                            <span><strong>{candidate.modelName}</strong><small>{candidate.versionName} · {candidate.fileName}</small></span>
                            <span className={candidate.score >= 130 ? 'exact' : ''}>{candidate.score >= 130 ? (lang === 'fr' ? 'Exact' : 'Exact') : `${candidate.score}%`}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="civitai-linked-list">
                  {civitaiDisplayedModels.map(favorite => {
                    const modelType = favorite.modelType;
                    const link = civitaiModelLinks.find(item => item.localModel === favorite.model && item.modelType === modelType);
                    return (
                      <div className={`civitai-linked-row ${link ? 'linked' : 'unlinked'}`} key={`${modelType}:${favorite.model}`}>
                        <span className="civitai-link-state" aria-hidden="true">{link ? <CheckIcon size={16} /> : '!'}</span>
                        <span className="civitai-local-name"><strong>{getModelDisplayName(favorite.model)}</strong><small>{favorite.model}</small></span>
                        <span className="civitai-remote-name">
                          {link ? <><strong>{link.modelName}</strong><small>{link.versionName} · {link.autoV2 || 'Hash indisponible'}</small></> : <small>{lang === 'fr' ? 'Non associé' : 'Not linked'}</small>}
                        </span>
                        <button type="button" className="civitai-row-action" onClick={() => void requestCivitaiCandidates(favorite.model, modelType)} disabled={isSearchingCivitai}>
                          {link ? (lang === 'fr' ? 'Modifier' : 'Change') : (lang === 'fr' ? 'Rechercher' : 'Search')}
                        </button>
                        {link && <button type="button" className="civitai-row-remove" title={lang === 'fr' ? 'Supprimer l’association' : 'Remove link'} onClick={() => setParams(current => ({
                          ...current,
                          civitaiModelLinks: (current.civitaiModelLinks || []).filter(item => !(item.localModel === favorite.model && item.modelType === modelType)),
                        }))}><TrashIcon size={16} /></button>}
                      </div>
                    );
                  })}
                  {!favoriteModels.length && <p className="favorite-model-empty">{lang === 'fr' ? 'Ajoute d’abord des modèles favoris dans l’onglet ComfyUI.' : 'Add favorite models in the ComfyUI tab first.'}</p>}
                </div>
              </section>
            </div>
          )}

          */}
          {activeTab === 'plugins' && (
            <Suspense fallback={<div className="plugin-card"><p className="favorite-model-empty">Civitai…</p></div>}>
              <CivitaiPluginPanel
                params={params}
                setParams={setParams}
                lang={lang}
                comfyModels={comfyModels}
                diffusionModels={diffusionModels}
              />
            </Suspense>
          )}

          {activeTab === 'llm' && (
            <div className="settings-grid">
              <div className="setting-item">
                <label>{t.llmEnabled}</label>
                <div className="toggle-container" onClick={() => setParams({ ...params, llmEnabled: !params.llmEnabled })}>
                  <div className={`toggle-switch ${params.llmEnabled ? 'on' : ''}`}></div>
                </div>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <LLMProvidersPanel
                  params={params}
                  setParams={setParams}
                  t={t}
                  beforeVision={(
                    <div className="setting-item">
                      <label>{t.llmSystemMessage}</label>
                      <div className="textarea-with-reset">
                        <textarea
                          className="system-message-textarea"
                          value={localLLMSystemMessage}
                          onChange={(e) => setLocalLLMSystemMessage(e.target.value)}
                          rows={5}
                        />
                        <button
                          type="button"
                          onClick={resetLLMSystemMessage}
                          disabled={localLLMSystemMessage === DEFAULT_LLM_SYSTEM_MESSAGE && params.llmSystemMessage === DEFAULT_LLM_SYSTEM_MESSAGE}
                          title={t.resetSystemMessage || 'Reset to the original system prompt'}
                          aria-label={t.resetSystemMessage || 'Reset to the original system prompt'}
                        >
                          ↺
                        </button>
                      </div>
                      <button
                        className="action-btn-small"
                        onClick={() => handleSaveTextarea('llmSystemMessage')}
                        disabled={localLLMSystemMessage === params.llmSystemMessage}
                        style={{ marginTop: '0.5rem', alignSelf: 'flex-start' }}
                      >
                        {t.save}
                      </button>
                    </div>
                  )}
                />
              </div>
            </div>
          )}

          {activeTab === 'admin' && (
            <div className="settings-grid admin-panel">
              <div className="setting-item" style={{ gridColumn: 'span 2' }}>
                <div className="admin-users-toolbar">
                  <div>
                    <h3>{t.userList}</h3>
                    <p>{t.userListHelp}</p>
                  </div>
                  <button
                    type="button"
                    className="add-user-trigger"
                    onClick={() => {
                      setNewUser({ username: '', password: '', isAdmin: false, queueLimit: 25 });
                      setIsCreatingUser(true);
                    }}
                  >
                    <PlusIcon size={18} />
                    {t.addUser}
                  </button>
                </div>
                <div className="user-table-wrapper">
                  <table className="user-table">
                    <thead>
                      <tr>
                        <th>{t.username}</th>
                        <th>{t.role}</th>
                        <th>{t.images}</th>
                        <th>{t.diskUsage}</th>
                        <th>{t.queueQuota}</th>
                        <th>{t.actions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminUsers.map(u => (
                        <tr
                          key={u.id}
                          className="user-table-row"
                          tabIndex={0}
                          onClick={() => setEditingUser(u)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setEditingUser(u);
                            }
                          }}
                          aria-label={`${t.editUser}: ${u.username}`}
                        >
                          <td>
                            <div className="user-table-identity">
                              <span className="user-table-avatar" aria-hidden="true">
                                {u.avatarUrl ? <img src={getFullImageUrl(getAvatarThumbnailUrl(u.avatarUrl))} alt="" /> : u.username.charAt(0).toUpperCase()}
                              </span>
                              <strong>{u.username}</strong>
                            </div>
                          </td>
                          <td>{u.isAdmin ? t.admin : t.user}</td>
                          <td>{u.imageCount || 0}</td>
                          <td>{formatBytes(u.diskUsage || 0)}</td>
                          <td>
                            <span className="user-queue-summary">
                              {u.queueLimit === null ? t.unlimited : (u.queueLimit ?? 25)}
                              <small>{u.activeQueueCount || 0} {t.active}</small>
                            </span>
                          </td>
                          <td className="user-actions-cell">
                            <div className="action-buttons-wrapper">
                              <button
                                className="reset-user-btn"
                                onClick={event => { event.stopPropagation(); setEditingUser(u); }}
                                title={t.editUser}
                                aria-label={`${t.editUser}: ${u.username}`}
                              >
                                <KeyIcon size={17} />
                              </button>
                              <button
                                className="delete-user-btn"
                                onClick={event => { event.stopPropagation(); deleteUser(u.id); }}
                                disabled={u.username === currentUser?.username}
                                title={t.deleteUser}
                                aria-label={`${t.deleteUser}: ${u.username}`}
                              >
                                <TrashIcon size={17} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {editingUser && (
                <AdminUserEditor
                  key={editingUser.id}
                  user={editingUser}
                  currentUsername={currentUser?.username}
                  lang={lang}
                  t={t}
                  onClose={() => setEditingUser(null)}
                  onSave={updateAdminUser}
                  onDelete={deleteUser}
                />
              )}

              {isCreatingUser && (
                <CreateAdminUserModal
                  user={newUser}
                  setUser={setNewUser}
                  t={t}
                  loading={isAdminLoading}
                  onClose={() => {
                    setIsCreatingUser(false);
                    setNewUser({ username: '', password: '', isAdmin: false, queueLimit: 25 });
                  }}
                  onCreate={handleAddUser}
                />
              )}

            </div>
          )}

          {activeTab === 'logs' && currentUser?.isAdmin && <AdminLogsPanel t={t} />}
          {activeTab === 'queue' && currentUser?.isAdmin && <AdminQueuePanel lang={lang} />}
          
          {activeTab === 'update' && <UpdateTab t={t} />}
          </main>
        </div>
      </div>
      {showThumbnailCacheConfirm && thumbnailCacheStats && (
        <div
          className="thumbnail-cache-confirm-overlay"
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Escape' && !isPurgingThumbnailCache) setShowThumbnailCacheConfirm(false);
          }}
          onClick={event => {
            event.stopPropagation();
            if (!isPurgingThumbnailCache) setShowThumbnailCacheConfirm(false);
          }}
        >
          <div
            className="thumbnail-cache-confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="thumbnail-cache-confirm-title"
            aria-describedby="thumbnail-cache-confirm-description"
            onClick={event => event.stopPropagation()}
          >
            <span className="thumbnail-cache-confirm-icon" aria-hidden="true"><AlertTriangleIcon size={24} /></span>
            <h3 id="thumbnail-cache-confirm-title">{t.thumbnailCacheConfirmTitle}</h3>
            <p id="thumbnail-cache-confirm-description">
              {t.thumbnailCacheConfirmHelp
                .replace('{count}', new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US').format(thumbnailCacheStats.fileCount))
                .replace('{size}', formatBytes(thumbnailCacheStats.totalBytes))}
            </p>
            <p className="thumbnail-cache-confirm-note">{t.thumbnailCacheConfirmNote}</p>
            <div className="thumbnail-cache-confirm-actions">
              <button
                ref={thumbnailCacheCancelRef}
                type="button"
                className="thumbnail-cache-cancel-btn"
                onClick={() => setShowThumbnailCacheConfirm(false)}
                disabled={isPurgingThumbnailCache}
              >
                {t.cancel}
              </button>
              <button
                type="button"
                className="thumbnail-cache-confirm-btn"
                onClick={() => void purgeThumbnailCacheFiles()}
                disabled={isPurgingThumbnailCache}
              >
                <TrashIcon size={17} />
                {isPurgingThumbnailCache ? t.thumbnailCachePurging : t.thumbnailCacheConfirmAction}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface UpdateInfo {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  localVersionAhead?: boolean;
  releaseUrl?: string;
  releaseNotes?: string;
  publishedAt?: string;
  error?: string;
}

const UpdateTab = ({ t }: { t: Record<string, string> }) => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const interfaceServerMismatch = Boolean(
    updateInfo
    && updateInfo.currentVersion !== '?'
    && updateInfo.currentVersion !== APP_CONFIG.VERSION
  );

  const checkUpdate = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/updates/check`, { credentials: 'include' });
      const data = await res.json();
      setUpdateInfo(data);
    } catch (err) {
      console.error('Update check failed:', err);
      setUpdateInfo({ currentVersion: '?', error: 'Impossible de contacter le serveur' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkUpdate();
  }, []);

  return (
    <div className="settings-grid">
      <div className="setting-item" style={{ gridColumn: 'span 2' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <label style={{ margin: 0 }}>{t.currentVersion}</label>
          <button className="refresh-models-btn" onClick={checkUpdate} disabled={isLoading}>
            {isLoading ? '...' : <RefreshIcon size={16} />}
          </button>
        </div>

        {updateInfo && (
          <div className={`update-status-card ${interfaceServerMismatch ? 'is-mismatch' : updateInfo.updateAvailable ? 'has-update' : 'is-synchronized'}`}>
            <div className="update-status-heading">
              <span className="update-status-icon" aria-hidden="true">
                {interfaceServerMismatch || updateInfo.updateAvailable
                  ? <AlertTriangleIcon size={20} />
                  : <CheckCircleIcon size={20} />}
              </span>
              <div>
                <span>{t.versionStatus}</span>
                <strong>
                  {interfaceServerMismatch
                    ? t.versionSyncRequired
                    : updateInfo.updateAvailable
                      ? t.updateAvailable
                      : t.versionSynchronized}
                </strong>
              </div>
            </div>

            <div className="update-version-flow">
              <div className={`update-version-node ${interfaceServerMismatch ? 'is-warning' : 'is-current'}`}>
                <span>{t.interfaceVersion}</span>
                <strong>v{APP_CONFIG.VERSION}</strong>
                <small><i aria-hidden="true" />{interfaceServerMismatch ? t.versionDifferent : t.versionCurrent}</small>
              </div>
              <span className="update-version-connector" aria-hidden="true">→</span>
              <div className={`update-version-node ${updateInfo.updateAvailable ? 'is-warning' : 'is-current'}`}>
                <span>{t.serverVersion}</span>
                <strong>v{updateInfo.currentVersion}</strong>
                <small><i aria-hidden="true" />{updateInfo.updateAvailable ? t.versionDifferent : t.versionCurrent}</small>
              </div>
              <span className="update-version-connector" aria-hidden="true">→</span>
              <div className="update-version-node is-reference">
                <span>{t.githubVersion}</span>
                <strong>{updateInfo.latestVersion ? `v${updateInfo.latestVersion}` : '---'}</strong>
                <small><i aria-hidden="true" />{t.versionReference}</small>
              </div>
            </div>

            {interfaceServerMismatch && (
              <div className="update-remediation">
                <span aria-hidden="true"><RefreshIcon size={18} /></span>
                <div>
                  <strong>{t.versionMismatchTitle}</strong>
                  <p>{t.interfaceServerVersionMismatch}</p>
                </div>
              </div>
            )}

            {updateInfo.updateAvailable ? (
              <div className="update-available-action">
                <a href={updateInfo.releaseUrl} target="_blank" rel="noopener noreferrer" className="action-btn-large">
                  {t.viewOnGitHub}
                </a>
              </div>
            ) : updateInfo.localVersionAhead ? (
              <p className="update-version-note"><SparklesIcon size={18} /> {t.localVersionAhead}</p>
            ) : updateInfo.error ? (
              <p className="update-version-error"><AlertTriangleIcon size={18} /> {updateInfo.error}</p>
            ) : null}
          </div>
        )}

        {updateInfo?.releaseNotes && (
          <>
            <label>{t.devLogs} (Latest)</label>
            <div className="logs-container" style={{
              background: 'rgba(0,0,0,0.2)',
              padding: '1rem',
              borderRadius: '8px',
              maxHeight: '300px',
              overflowY: 'auto',
              fontSize: '0.85rem',
              lineHeight: '1.4'
            }}>
              <div className="markdown-logs">
                <MarkdownLoader content={updateInfo.releaseNotes} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
