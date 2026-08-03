import React, { useState, useLayoutEffect, useEffect, useRef } from 'react';
import './ChatInterface.css';
import type { Message, Language, GalleryItem, GenParameters, PromptTag } from '../../types';
import { WelcomeScreen } from './WelcomeScreen';
import { MessageText } from './MessageText';
import { SeedyCompanion } from './SeedyCompanion';
import { InfoIcon, RefreshIcon, SendIcon, ChatIcon, PlusIcon, XIcon, ChevronDownIcon, ThumbUpIcon, ComposeIcon, MagicWandIcon, CameraIcon } from '../ui/Icons';
import { API_BASE, getFullImageUrl, formatDuration } from '../../services/api';
import {
  getEstimatedGenerationProgress,
  getGenerationElapsedSeconds,
  getTrackedGenerationElapsedSeconds
} from '../../utils/generationTimer';
import { hasResolvableRandomPrompt } from '../../utils/randomPrompts';
import {
  getSlashCommandQuery,
  parseBoundedNumberCommand,
  parseSeedCommand,
  parseSlashCommand,
  type SlashCommandName
} from '../../utils/slashCommands';
import toast from 'react-hot-toast';

const LUCKY_PHRASE_COUNT = 5;
const MIN_GALLERY_COLUMNS = 1;
const MAX_GALLERY_COLUMNS = 6;
const GALLERY_PINCH_STEP = 1.16;
const GALLERY_LONG_PRESS_MS = 1000;
const GALLERY_LONG_PRESS_MOVE_TOLERANCE = 12;
const VISION_RECOVERY_STORAGE_KEY = 'comfyforge.pendingVisionRecovery';

const createVisionRecoveryId = () => {
  if (typeof window.crypto?.randomUUID === 'function') return window.crypto.randomUUID();
  return `vision-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};

const createSafeImagePreview = async (file: File) => {
  const bitmap = await createImageBitmap(file);
  try {
    const maxDimension = 1024;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare image preview');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const previewBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Unable to encode image preview'));
      }, 'image/png');
    });
    return URL.createObjectURL(previewBlob);
  } finally {
    bitmap.close();
  }
};

const normalizeSearchValue = (value: string) => value
  .toLocaleLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const getTouchDistance = (touches: React.TouchList) => {
  const [first, second] = [touches.item(0), touches.item(1)];
  if (!first || !second) return 0;
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
};

const GenerationProgress = React.memo(({ message }: { message: Message }) => {
  const [estimate, setEstimate] = useState<{
    durationSeconds: number;
    trackingStartedAt: number;
    elapsedAtTrackingStart: number;
  }>();
  const fillRef = useRef<HTMLSpanElement>(null);
  const latestDurationRef = useRef(message.duration);

  useEffect(() => {
    latestDurationRef.current = message.duration;
  }, [message.duration]);

  useEffect(() => {
    if (message.status !== 'processing' || !message.model || !message.workflow) {
      setEstimate(undefined);
      return;
    }

    setEstimate(undefined);
    const controller = new AbortController();
    const query = new URLSearchParams({
      model: message.model,
      workflow: message.workflow
    });

    void fetch(`${API_BASE}/api/generate/estimate?${query.toString()}`, {
      credentials: 'include',
      signal: controller.signal
    })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (typeof data?.estimateSeconds === 'number' && data.estimateSeconds > 0) {
          setEstimate({
            durationSeconds: data.estimateSeconds,
            trackingStartedAt: Date.now(),
            elapsedAtTrackingStart: Math.max(1, latestDurationRef.current ?? 0)
          });
        }
      })
      .catch(error => {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('[Generation] Failed to load duration estimate:', error);
        }
      });

    return () => controller.abort();
  }, [message.model, message.status, message.workflow]);

  useLayoutEffect(() => {
    if (estimate === undefined || message.status !== 'processing') return;

    let animationFrame: number | undefined;
    const updateProgress = () => {
      const elapsedSeconds = getTrackedGenerationElapsedSeconds(
        message.duration,
        message.generationStartedAt,
        estimate.trackingStartedAt,
        estimate.elapsedAtTrackingStart,
        Date.now()
      );
      const progress = getEstimatedGenerationProgress(elapsedSeconds, estimate.durationSeconds);
      if (progress !== undefined && fillRef.current) {
        fillRef.current.style.width = `${progress}%`;
      }
      animationFrame = window.requestAnimationFrame(updateProgress);
    };

    updateProgress();
    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [estimate, message.duration, message.generationStartedAt, message.status]);

  if (estimate === undefined) return null;

  return (
    <span className="generation-estimate-track" aria-hidden="true">
      <span
        ref={fillRef}
        className="generation-estimate-fill"
      />
    </span>
  );
});

interface ChatInterfaceProps {
  view: 'chat' | 'gallery' | 'archives';
  messages: Message[];
  lang: Language;
  t: Record<string, string>;
  isGenerating: boolean;
  isEnhancing: boolean;
  currentSessionId: string | null;
  input: string;
  setInput: (val: string) => void;
  handleSend: (
    overrideInput?: string,
    isRegeneration?: boolean,
    skipEnhancement?: boolean,
    forceEnhancement?: boolean
  ) => void | Promise<void>;
  createLuckyGeneration: (keywords?: string) => Promise<void>;
  isCreatingLuckyPrompt: boolean;
  isLoadingLuckyReferences: boolean;
  regenerationCounts: Record<string, number>;
  recordRegeneration: (messageId: string) => void;
  retryMessage: (messageId: string) => Promise<unknown>;
  dismissFailedMessage: (messageId: string) => void;
  retryAllIncomplete: () => Promise<{ queued: number }>;
  updatePendingPrompt: (messageId: string, prompt: string, localUserMessageId?: string) => Promise<unknown>;
  interruptGeneration: () => void;
  handleEdit: (text: string) => void;
  goToImage: (sessionId: string, messageId: string) => void;
  openComparison: (messageId: string) => void;
  setActiveInfoId: (id: string | null) => void;
  activeInfoId: string | null;
  setMessageToDelete: (id: string | null) => void;
  toggleFavorite: (sessionId: string, messageId: string, currentStatus: number | undefined) => void;
  togglePromptFavorite: (sessionId: string, messageId: string, currentStatus: number | undefined) => void;
  handleImageClick: (item: { url: string, thumbnailUrl?: string, sessionId: string, messageId: string, isFavorite?: number, source: 'chat' | 'gallery' }) => void;
  favoritedId: string | null;
  galleryItems: GalleryItem[];
  batchDeleteGalleryItems: (items: GalleryItem[]) => Promise<void>;
  batchRegenerateGalleryItems: (items: GalleryItem[]) => Promise<void>;
  batchLuckyGalleryItems: (items: GalleryItem[]) => Promise<void>;
  batchSetGalleryFavorites: (items: GalleryItem[], value: number) => Promise<void>;
  batchSetGalleryPromptFavorites: (items: GalleryItem[], value: number) => Promise<void>;
  galleryTotal: number;
  isFetchingGallery: boolean;
  favoritesOnly: boolean;
  setFavoritesOnly: (val: boolean) => void;
  availablePromptTags: PromptTag[];
  selectedPromptTags: string[];
  setSelectedPromptTags: (tags: string[]) => void;
  gallerySearch: string;
  setGallerySearch: (value: string) => void;
  openPromptTag: (slug: string) => void;
  showArchivedInGallery: boolean;
  setShowArchivedInGallery: (val: boolean) => void;
  setHasMoreGallery: (val: boolean) => void;
  lastImageElementRef: (node: HTMLDivElement) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  params: GenParameters;
  setParams: React.Dispatch<React.SetStateAction<GenParameters>>;
  smoothScrollTo: (id: string) => void;
  handleScroll: (isUserScroll?: boolean | React.UIEvent) => void;
  downloadImage: (url: string, filename: string) => void;
  showScrollBottom?: boolean;
  onScrollToBottom?: () => void;
  openOptionsRequest?: number;
}

export const ChatInterface = ({
  view,
  messages,
  lang,
  t,
  isGenerating,
  isEnhancing,
  currentSessionId,
  input,
  setInput,
  handleSend,
  createLuckyGeneration,
  isCreatingLuckyPrompt,
  isLoadingLuckyReferences,
  regenerationCounts,
  recordRegeneration,
  retryMessage,
  dismissFailedMessage,
  retryAllIncomplete,
  updatePendingPrompt,
  interruptGeneration,
  handleEdit,
  goToImage,
  openComparison,
  setActiveInfoId,
  activeInfoId,
  setMessageToDelete,
  toggleFavorite,
  togglePromptFavorite,
  handleImageClick,
  favoritedId,
  galleryItems,
  batchDeleteGalleryItems,
  batchRegenerateGalleryItems,
  batchLuckyGalleryItems,
  batchSetGalleryFavorites,
  batchSetGalleryPromptFavorites,
  galleryTotal,
  isFetchingGallery,
  favoritesOnly,
  setFavoritesOnly,
  availablePromptTags,
  selectedPromptTags,
  setSelectedPromptTags,
  gallerySearch,
  setGallerySearch,
  openPromptTag,
  showArchivedInGallery,
  setShowArchivedInGallery,
  lastImageElementRef,
  containerRef,
  textareaRef,
  messagesEndRef,
  params,
  setParams,
  smoothScrollTo,
  handleScroll,
  downloadImage,
  showScrollBottom,
  onScrollToBottom,
  openOptionsRequest = 0
}: ChatInterfaceProps) => {
  const [showOptions, setShowOptions] = useState(false);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [isRetryingAll, setIsRetryingAll] = useState(false);
  const [showRetryAllConfirm, setShowRetryAllConfirm] = useState(false);
  const [luckyPhraseIndex, setLuckyPhraseIndex] = useState(0);
  const [showLuckyInfo, setShowLuckyInfo] = useState(false);
  const [slashCommandIndex, setSlashCommandIndex] = useState(0);
  const [isResolvingSlashCommand, setIsResolvingSlashCommand] = useState(false);
  const [isPromptFocused, setIsPromptFocused] = useState(false);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [analysisStartedAt, setAnalysisStartedAt] = useState(0);
  const [analysisPreview, setAnalysisPreview] = useState<{ url: string } | null>(null);
  const [pendingVisionRecoveryId, setPendingVisionRecoveryId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : window.localStorage.getItem(VISION_RECOVERY_STORAGE_KEY)
  );
  const [isGallerySearchFocused, setIsGallerySearchFocused] = useState(false);
  const [pendingPromptEditor, setPendingPromptEditor] = useState<{
    displayMessageId: string;
    targetMessageId: string;
    localUserMessageId?: string;
  } | null>(null);
  const [pendingPromptDraft, setPendingPromptDraft] = useState('');
  const [isSavingPendingPrompt, setIsSavingPendingPrompt] = useState(false);
  const [galleryColumns, setGalleryColumns] = useState(() => {
    const savedColumns = Number.parseInt(localStorage.getItem('galleryColumns') || '', 10);
    if (savedColumns >= MIN_GALLERY_COLUMNS && savedColumns <= MAX_GALLERY_COLUMNS) return savedColumns;
    return window.innerWidth <= 768 ? 3 : 6;
  });
  const [isPinchingGallery, setIsPinchingGallery] = useState(false);
  const [selectedGalleryIds, setSelectedGalleryIds] = useState<Set<string>>(() => new Set());
  const [galleryBatchMenuOpen, setGalleryBatchMenuOpen] = useState(false);
  const [galleryBatchBusy, setGalleryBatchBusy] = useState(false);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const imageImportRef = useRef<HTMLInputElement>(null);
  const optionsDrawerRef = useRef<HTMLDivElement>(null);
  const optionsToggleRef = useRef<HTMLButtonElement>(null);
  const wasCreatingLuckyPromptRef = useRef(false);
  const galleryPinchRef = useRef({ startDistance: 0, startColumns: galleryColumns, changed: false });
  const suppressGalleryClickRef = useRef(false);
  const suppressGalleryClickTimerRef = useRef<number | null>(null);
  const gallerySelectionModeRef = useRef(false);
  const galleryLongPressRef = useRef<{
    timer: number;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);

  useEffect(() => {
    localStorage.setItem('galleryColumns', String(galleryColumns));
  }, [galleryColumns]);

  useEffect(() => {
    if (openOptionsRequest > 0) setShowOptions(true);
  }, [openOptionsRequest]);

  useEffect(() => () => {
    if (galleryLongPressRef.current) window.clearTimeout(galleryLongPressRef.current.timer);
    if (suppressGalleryClickTimerRef.current !== null) {
      window.clearTimeout(suppressGalleryClickTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const visibleIds = new Set(galleryItems.map(item => item.messageId));
    setSelectedGalleryIds(current => {
      const next = new Set([...current].filter(id => visibleIds.has(id)));
      if (next.size === current.size) return current;
      if (next.size === 0) {
        gallerySelectionModeRef.current = false;
        setGalleryBatchMenuOpen(false);
      }
      return next;
    });
  }, [galleryItems]);

  useEffect(() => {
    if (view === 'gallery') return;
    gallerySelectionModeRef.current = false;
    setSelectedGalleryIds(new Set());
    setGalleryBatchMenuOpen(false);
    if (galleryLongPressRef.current) {
      window.clearTimeout(galleryLongPressRef.current.timer);
      galleryLongPressRef.current = null;
    }
  }, [view]);

  useEffect(() => () => {
    if (analysisPreview?.url) URL.revokeObjectURL(analysisPreview.url);
  }, [analysisPreview]);

  useEffect(() => {
    if (!pendingVisionRecoveryId) return;
    let cancelled = false;
    let pollTimer: number | undefined;
    const startedAt = Date.now();
    const deadline = startedAt + 3 * 60 * 1000;
    setAnalysisStartedAt(startedAt);
    setTimerNow(startedAt);
    setIsAnalyzingImage(true);

    const finishRecovery = () => {
      window.localStorage.removeItem(VISION_RECOVERY_STORAGE_KEY);
      setPendingVisionRecoveryId(null);
      setIsAnalyzingImage(false);
      setAnalysisPreview(null);
      if (imageImportRef.current) imageImportRef.current.value = '';
    };
    const schedulePoll = () => {
      if (cancelled) return;
      if (Date.now() >= deadline) {
        toast.error(lang === 'fr'
          ? 'La récupération du prompt Vision a expiré.'
          : 'Vision prompt recovery timed out.');
        finishRecovery();
        return;
      }
      pollTimer = window.setTimeout(poll, 2500);
    };
    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/llm/vision-recoveries/${encodeURIComponent(pendingVisionRecoveryId)}`, {
          credentials: 'include',
        });
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (response.ok && data.status === 'completed' && typeof data.prompt === 'string' && data.prompt.trim()) {
          setInput(data.prompt.trim());
          toast.success(t.visionAnalysisReady || 'Detailed prompt ready');
          finishRecovery();
          window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
          return;
        }
        if (response.ok && data.status === 'failed') {
          toast.error(data.error || 'Image analysis failed');
          finishRecovery();
          return;
        }
        if (response.status === 400 || (response.status === 404 && Date.now() >= deadline)) {
          finishRecovery();
          return;
        }
        schedulePoll();
      } catch {
        schedulePoll();
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    };
  }, [lang, pendingVisionRecoveryId, setInput, t.visionAnalysisReady, textareaRef]);

  const analyzeImportedImage = async (file: File) => {
    if (!params.visionProviderId || !params.visionModel) {
      toast.error(t.visionSetupRequired || 'Choose a vision provider and model in LLM settings first.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) {
      toast.error(t.visionUnsupportedFormat || 'Use a JPEG, PNG, WebP, or AVIF image.');
      return;
    }
    if (file.size > 15_000_000) {
      toast.error(t.visionFileTooLarge || 'The image must be smaller than 15 MB.');
      return;
    }

    const previewUrl = await createSafeImagePreview(file).catch(() => null);
    setAnalysisPreview(previewUrl ? { url: previewUrl } : null);
    const startedAt = Date.now();
    setAnalysisStartedAt(startedAt);
    setTimerNow(startedAt);
    setIsAnalyzingImage(true);
    setShowOptions(false);
    window.setTimeout(() => smoothScrollTo('vision-analysis-post'), 60);

    const recoveryId = createVisionRecoveryId();
    window.localStorage.setItem(VISION_RECOVERY_STORAGE_KEY, recoveryId);
    let requestSent = false;
    let definitiveFailure = false;
    let recoveryPending = false;
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = () => reject(reader.error || new Error('Unable to read image'));
        reader.readAsDataURL(file);
      });
      requestSent = true;
      const response = await fetch(`${API_BASE}/api/llm/analyze-image`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: params.visionProviderId,
          model: params.visionModel,
          systemMessage: params.visionSystemMessage,
          ttlSeconds: (params.visionModelTtlMinutes || 30) * 60,
          mimeType: file.type,
          image,
          recoveryId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      definitiveFailure = !response.ok;
      if (!response.ok || !data.prompt) throw new Error(data.error || 'Image analysis failed');
      setInput(data.prompt.trim());
      window.localStorage.removeItem(VISION_RECOVERY_STORAGE_KEY);
      toast.success(t.visionAnalysisReady || 'Detailed prompt ready');
      window.requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    } catch (error) {
      if (requestSent && !definitiveFailure) {
        recoveryPending = true;
        setPendingVisionRecoveryId(recoveryId);
        toast(t.visionRecoveryPending || (lang === 'fr'
          ? 'Connexion interrompue : récupération automatique du prompt en cours…'
          : 'Connection interrupted: recovering the prompt automatically…'));
      } else {
        window.localStorage.removeItem(VISION_RECOVERY_STORAGE_KEY);
        toast.error(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (!recoveryPending) {
        setIsAnalyzingImage(false);
        setAnalysisPreview(null);
        if (imageImportRef.current) imageImportRef.current.value = '';
      }
    }
  };

  const handleGalleryTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return;
    if (galleryLongPressRef.current) {
      window.clearTimeout(galleryLongPressRef.current.timer);
      galleryLongPressRef.current = null;
    }
    if (suppressGalleryClickTimerRef.current !== null) {
      window.clearTimeout(suppressGalleryClickTimerRef.current);
      suppressGalleryClickTimerRef.current = null;
    }
    suppressGalleryClickRef.current = false;
    galleryPinchRef.current = {
      startDistance: getTouchDistance(event.touches),
      startColumns: galleryColumns,
      changed: false,
    };
    setIsPinchingGallery(true);
  };

  const handleGalleryTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || galleryPinchRef.current.startDistance === 0) return;
    event.preventDefault();

    const distance = getTouchDistance(event.touches);
    const scale = distance / galleryPinchRef.current.startDistance;
    const columnDelta = Math.round(-Math.log(scale) / Math.log(GALLERY_PINCH_STEP));
    const nextColumns = Math.min(
      MAX_GALLERY_COLUMNS,
      Math.max(MIN_GALLERY_COLUMNS, galleryPinchRef.current.startColumns + columnDelta)
    );

    if (nextColumns !== galleryPinchRef.current.startColumns) {
      galleryPinchRef.current.changed = true;
      suppressGalleryClickRef.current = true;
    }
    setGalleryColumns(current => current === nextColumns ? current : nextColumns);
  };

  const handleGalleryTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isPinchingGallery || event.touches.length >= 2) return;
    setIsPinchingGallery(false);
    galleryPinchRef.current.startDistance = 0;

    if (galleryPinchRef.current.changed) {
      if (suppressGalleryClickTimerRef.current !== null) {
        window.clearTimeout(suppressGalleryClickTimerRef.current);
      }
      suppressGalleryClickTimerRef.current = window.setTimeout(() => {
        suppressGalleryClickRef.current = false;
      }, 350);
    }
  };

  const cancelGalleryLongPress = (pointerId?: number) => {
    const press = galleryLongPressRef.current;
    if (!press || (pointerId !== undefined && press.pointerId !== pointerId)) return;
    window.clearTimeout(press.timer);
    galleryLongPressRef.current = null;
  };

  const startGalleryLongPress = (event: React.PointerEvent<HTMLDivElement>, messageId: string) => {
    if (selectedGalleryIds.size > 0 || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    cancelGalleryLongPress();
    const { pointerId, clientX, clientY } = event;
    const timer = window.setTimeout(() => {
      galleryLongPressRef.current = null;
      suppressGalleryClickRef.current = true;
      gallerySelectionModeRef.current = true;
      setSelectedGalleryIds(new Set([messageId]));
      if ('vibrate' in navigator) navigator.vibrate(35);
      suppressGalleryClickTimerRef.current = window.setTimeout(() => {
        suppressGalleryClickRef.current = false;
      }, 400);
    }, GALLERY_LONG_PRESS_MS);
    galleryLongPressRef.current = { timer, pointerId, startX: clientX, startY: clientY };
  };

  const moveGalleryLongPress = (event: React.PointerEvent<HTMLDivElement>) => {
    const press = galleryLongPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > GALLERY_LONG_PRESS_MOVE_TOLERANCE) {
      cancelGalleryLongPress(event.pointerId);
    }
  };

  const toggleGallerySelection = (messageId: string) => {
    setSelectedGalleryIds(current => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      if (next.size === 0) {
        gallerySelectionModeRef.current = false;
        setGalleryBatchMenuOpen(false);
      }
      return next;
    });
  };

  const clearGallerySelection = () => {
    cancelGalleryLongPress();
    if (suppressGalleryClickTimerRef.current !== null) {
      window.clearTimeout(suppressGalleryClickTimerRef.current);
      suppressGalleryClickTimerRef.current = null;
    }
    suppressGalleryClickRef.current = false;
    gallerySelectionModeRef.current = false;
    setSelectedGalleryIds(new Set());
    setGalleryBatchMenuOpen(false);
  };

  const selectedGalleryItems = galleryItems.filter(item => selectedGalleryIds.has(item.messageId));
  const selectedAreAllFavorites = selectedGalleryItems.length > 0 && selectedGalleryItems.every(item => item.isFavorite === 1);
  const selectedAreAllPromptFavorites = selectedGalleryItems.length > 0 && selectedGalleryItems.every(item => item.isPromptFavorite === 1);

  const runGalleryBatchAction = async (action: () => Promise<void>, successMessage?: string) => {
    if (galleryBatchBusy || selectedGalleryItems.length === 0) return;
    setGalleryBatchBusy(true);
    clearGallerySelection();
    try {
      await action();
      if (successMessage) toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setGalleryBatchBusy(false);
    }
  };

  useEffect(() => {
    if (!showOptions) return;

    const closeOptionsOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        optionsDrawerRef.current?.contains(target)
        || optionsToggleRef.current?.contains(target)
        || textareaRef.current?.contains(target)
      ) return;
      setShowOptions(false);
    };

    document.addEventListener('pointerdown', closeOptionsOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOptionsOnOutsidePress);
  }, [showOptions, textareaRef]);

  const enabledRandomSlugs = new Set(
    params.randomPromptLists
      .filter(list => list.enabled && list.slug && list.values.some(value => value.trim()))
      .map(list => list.slug.toLowerCase())
  );
  const promptParts = input.split(/(\[[a-zA-Z0-9_-]+\])/g);
  const hasRandomCodes = promptParts.some(part => (
    part.startsWith('[')
    && part.endsWith(']')
    && enabledRandomSlugs.has(part.slice(1, -1).toLowerCase())
  ));
  const slashCommands: Array<{
    name: SlashCommandName;
    usage: string;
    description: string;
  }> = [
    { name: 'ai', usage: '/ai prompt', description: t.slashAiDescription },
    { name: 'luck', usage: '/luck bikini beach', description: t.slashLuckDescription },
    { name: 'seed', usage: '/seed 12345 | random', description: t.slashSeedDescription },
    { name: 'steps', usage: '/steps 12', description: t.slashStepsDescription },
    { name: 'cfg', usage: '/cfg 1.5', description: t.slashCfgDescription },
    { name: 'random', usage: '/random', description: t.slashRandomDescription },
    { name: 'favorite', usage: '/favorite', description: t.slashFavoriteDescription },
  ];
  const slashCommandQuery = getSlashCommandQuery(input);
  const matchingSlashCommands = slashCommandQuery === undefined
    ? []
    : slashCommands.filter(command => command.name.startsWith(slashCommandQuery));
  const showSlashCommandMenu = isPromptFocused && matchingSlashCommands.length > 0;

  useEffect(() => {
    setSlashCommandIndex(0);
  }, [slashCommandQuery]);

  const insertSlashCommand = (command: SlashCommandName) => {
    setInput(`/${command} `);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const loadSavedPrompt = async (source: 'liked' | 'favorite') => {
    setIsResolvingSlashCommand(true);
    try {
      const query = new URLSearchParams({ source });
      const response = await fetch(`${API_BASE}/api/gallery/random-prompt?${query.toString()}`, {
        credentials: 'include'
      });
      const data = await response.json();
      if (!response.ok || !data.prompt?.trim()) {
        throw new Error(source === 'favorite' ? t.slashNoFavoritePrompts : t.slashNoLikedPrompts);
      }
      setInput(data.prompt.trim());
      toast.success(t.slashPromptLoaded);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.slashNoLikedPrompts);
    } finally {
      setIsResolvingSlashCommand(false);
    }
  };

  const executePromptInput = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    const command = parseSlashCommand(trimmedInput);
    if (!command) {
      if (trimmedInput.startsWith('/')) {
        toast.error(t.slashUnknownCommand);
        return;
      }
      handleSend();
      return;
    }

    if (command.name === 'ai') {
      if (!command.argument) {
        toast.error(t.slashPromptRequired);
        return;
      }
      if (!params.llmProviderId) {
        toast.error(t.oneShotAiUnavailable);
        return;
      }
      setInput('');
      handleSend(command.argument, false, false, true);
      return;
    }

    if (command.name === 'luck') {
      setInput('');
      await createLuckyGeneration(command.argument);
      return;
    }

    if (command.name === 'random' || command.name === 'favorite') {
      await loadSavedPrompt(command.name === 'favorite' ? 'favorite' : 'liked');
      return;
    }

    if (command.name === 'seed') {
      const seed = parseSeedCommand(command.argument);
      if (!seed) {
        toast.error(`${t.slashInvalidValue}: /seed 12345 | random`);
        return;
      }
      setParams(current => ({ ...current, ...seed }));
    } else if (command.name === 'steps') {
      const steps = parseBoundedNumberCommand(command.argument, 1, 50, true);
      if (steps === undefined) {
        toast.error(`${t.slashInvalidValue}: /steps 1-50`);
        return;
      }
      setParams(current => ({ ...current, steps }));
    } else if (command.name === 'cfg') {
      const cfg = parseBoundedNumberCommand(command.argument, 0, 20);
      if (cfg === undefined) {
        toast.error(`${t.slashInvalidValue}: /cfg 0-20`);
        return;
      }
      setParams(current => ({ ...current, cfg }));
    }

    setInput('');
    toast.success(t.slashSettingApplied);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handlePromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashCommandMenu) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        setSlashCommandIndex(current => (
          current + direction + matchingSlashCommands.length
        ) % matchingSlashCommands.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const selected = matchingSlashCommands[slashCommandIndex];
        if (selected) insertSlashCommand(selected.name);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setInput('');
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void executePromptInput();
    }
  };
  const firstFailedMessageId = messages.find(message => message.role === 'bot' && message.status === 'failed')?.id;
  const normalizedGallerySearch = normalizeSearchValue(gallerySearch.trim());
  const matchingPromptTags = normalizedGallerySearch
    ? availablePromptTags
      .filter(tag => !selectedPromptTags.includes(tag.slug))
      .filter(tag => normalizeSearchValue(
        `${tag.slug} ${lang === 'fr' ? tag.labelFr : tag.labelEn}`
      ).includes(normalizedGallerySearch))
      .slice(0, 8)
    : [];

  const addPromptTag = (slug: string) => {
    if (!selectedPromptTags.includes(slug)) {
      setSelectedPromptTags([...selectedPromptTags, slug]);
    }
    setGallerySearch('');
  };

  const removePromptTag = (slug: string) => {
    setSelectedPromptTags(selectedPromptTags.filter(tag => tag !== slug));
  };

  const handleRetryAll = async () => {
    setShowRetryAllConfirm(false);
    setIsRetryingAll(true);
    try {
      const result = await retryAllIncomplete();
      toast.success(result.queued > 0 ? `${result.queued} ${t.retryQueued}` : t.nothingToRetry);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.retryFailed);
    } finally {
      setIsRetryingAll(false);
    }
  };

  const savePendingPrompt = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pendingPromptEditor || !pendingPromptDraft.trim() || isSavingPendingPrompt) return;
    setIsSavingPendingPrompt(true);
    try {
      await updatePendingPrompt(
        pendingPromptEditor.targetMessageId,
        pendingPromptDraft.trim(),
        pendingPromptEditor.localUserMessageId
      );
      setPendingPromptEditor(null);
      setPendingPromptDraft('');
      toast.success(t.pendingPromptUpdated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.pendingPromptUpdateFailed);
    } finally {
      setIsSavingPendingPrompt(false);
    }
  };

  const luckyPhrases = [
    t.luckyMagic1,
    t.luckyMagic2,
    t.luckyMagic3,
    t.luckyMagic4,
    t.luckyMagic5,
  ];

  useEffect(() => {
    if (!isCreatingLuckyPrompt) {
      setLuckyPhraseIndex(0);
      return;
    }
    const interval = window.setInterval(() => {
      setLuckyPhraseIndex(index => (index + 1) % LUCKY_PHRASE_COUNT);
    }, 1800);
    return () => window.clearInterval(interval);
  }, [isCreatingLuckyPrompt, lang]);

  useEffect(() => {
    if (!isCreatingLuckyPrompt) return;
    const timeout = window.setTimeout(() => {
      smoothScrollTo('lucky-generation-post');
    }, 60);
    return () => window.clearTimeout(timeout);
  }, [isCreatingLuckyPrompt, smoothScrollTo]);

  useEffect(() => {
    const wasCreating = wasCreatingLuckyPromptRef.current;
    wasCreatingLuckyPromptRef.current = isCreatingLuckyPrompt;
    if (!wasCreating || isCreatingLuckyPrompt || !onScrollToBottom) return;

    const timeout = window.setTimeout(onScrollToBottom, 100);
    return () => window.clearTimeout(timeout);
  }, [isCreatingLuckyPrompt, onScrollToBottom]);

  const syncPromptHighlightScroll = (textarea: HTMLTextAreaElement) => {
    if (!promptHighlightRef.current) return;
    promptHighlightRef.current.scrollTop = textarea.scrollTop;
    promptHighlightRef.current.scrollLeft = textarea.scrollLeft;
  };

  const insertRandomSlug = (slug: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? input.length;
    const end = textarea?.selectionEnd ?? input.length;
    const token = `[${slug}]`;
    const before = input.slice(0, start);
    const after = input.slice(end);
    const prefix = before && !/\s$/.test(before) ? ' ' : '';
    const suffix = after && !/^\s/.test(after) ? ' ' : '';
    const nextInput = `${before}${prefix}${token}${suffix}${after}`;
    const nextCursor = before.length + prefix.length + token.length;
    setInput(nextInput);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  useEffect(() => {
    const hasActiveGeneration = messages.some(message => (
      message.role === 'bot'
      && !message.imageUrl
      && !message.isEnhancing
      && message.status === 'processing'
    ));
    if (!hasActiveGeneration && !isAnalyzingImage) return;
    setTimerNow(Date.now());
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isAnalyzingImage, messages]);
  
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Step 1: Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      
      // Step 2: Get the scrollHeight
      const scrollHeight = textarea.scrollHeight;
      
      if (input) {
        // Step 3: Apply the height (it will be capped by max-height in CSS)
        textarea.style.height = `${scrollHeight}px`;
        // Step 4: Manage overflow based on height
        textarea.style.overflowY = scrollHeight >= 350 ? 'auto' : 'hidden';
      } else {
        // Reset to initial state when empty
        textarea.style.height = '';
        textarea.style.overflowY = 'hidden';
      }
      syncPromptHighlightScroll(textarea);
    }
  }, [input, textareaRef]);

  return (
    <>
      <div className={`messages-container view-${view}`} ref={containerRef} onScroll={() => handleScroll(true)}>
        {view === 'chat' || view === 'archives' ? (
          <>
            {messages.length === 0 && (
              view === 'chat' ? <WelcomeScreen lang={lang} /> : <div className="empty-state"><p>{t.noArchives}</p></div>
            )}
            {messages.map((msg, index) => {
              const messageText = (msg.text || msg.prompt || '').trim();
              const nextMessage = messages[index + 1];
              const linkedPendingMessage = msg.role === 'user'
                && nextMessage?.role === 'bot'
                && nextMessage.status === 'pending'
                && !nextMessage.imageUrl
                && !nextMessage.id.startsWith('temp-')
                && nextMessage.prompt === msg.text
                ? nextMessage
                : null;
              const directlyEditablePendingMessage = msg.role === 'bot'
                && msg.status === 'pending'
                && !msg.imageUrl
                && !msg.id.startsWith('temp-')
                ? msg
                : null;
              const editablePendingMessage = linkedPendingMessage || directlyEditablePendingMessage;
              const dynamicPrompt = msg.role === 'user' ? (msg.text || '') : '';
              const canRegenerateDynamicPrompt = hasResolvableRandomPrompt(dynamicPrompt, params.randomPromptLists);
              const prevMsg = index > 0 ? messages[index - 1] : null;
              const prevText = prevMsg ? (prevMsg.text || prevMsg.prompt || '').trim() : null;
              
              if (!messageText && !msg.imageUrl && msg.status !== 'pending' && msg.status !== 'processing') return null;

              const isRedundant = prevText === messageText;
              const shouldShowText = messageText && (!isRedundant || (msg.role === 'bot' && (msg.isEnhancing || msg.status === 'pending' || msg.status === 'preparing' || msg.status === 'processing')));
              const hasNonTextContent = Boolean(
                msg.imageUrl
                || msg.randomSelections?.length
                || (msg.role === 'bot' && (msg.status === 'pending' || msg.status === 'preparing' || msg.status === 'processing' || msg.status === 'failed'))
              );
              if (!shouldShowText && !hasNonTextContent) return null;
              
              return (
                <div key={msg.id} id={`msg-${msg.id}`} className={`message-row ${msg.role}`}>
                  <div className="avatar">{msg.role === 'user' ? 'U' : 'C'}</div>
                  <div className="message-content">
                    {shouldShowText && (
                      <div className="message-text-wrapper">
                        {pendingPromptEditor?.displayMessageId === msg.id ? (
                          <form className="pending-prompt-editor" onSubmit={savePendingPrompt}>
                            <textarea
                              value={pendingPromptDraft}
                              onChange={(event) => setPendingPromptDraft(event.target.value)}
                              maxLength={20_000}
                              rows={4}
                              autoFocus
                              disabled={isSavingPendingPrompt}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape' && !isSavingPendingPrompt) {
                                  event.preventDefault();
                                  setPendingPromptEditor(null);
                                  setPendingPromptDraft('');
                                }
                              }}
                            />
                            <div className="pending-prompt-editor-actions">
                              <button type="button" onClick={() => setPendingPromptEditor(null)} disabled={isSavingPendingPrompt}>{t.cancel}</button>
                              <button type="submit" className="save" disabled={!pendingPromptDraft.trim() || isSavingPendingPrompt}>
                                {isSavingPendingPrompt ? t.loading : t.savePrompt}
                              </button>
                            </div>
                          </form>
                        ) : (
                          <MessageText text={messageText} lang={lang} />
                        )}
                      </div>
                    )}
                  {msg.role === 'bot' && !!msg.randomSelections?.length && (
                    <div className="random-selection-summary" aria-label={t.randomDraws}>
                      {msg.randomSelections.map(selection => (
                        <span key={`${selection.slug}:${selection.value}`} title={`[${selection.slug}]`}>
                          <strong>{selection.name}</strong>
                          <span>{selection.value}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {msg.role === 'bot' && !msg.imageUrl && msg.status !== 'failed' && (
                    <div className="generation-placeholder">
                      <div className="generation-status-line">
                        <SeedyCompanion
                          state={msg.isEnhancing ? 'magic' : (msg.status === 'processing' ? 'working' : 'waiting')}
                          settings={params.companionSettings}
                        />
                        <p>
                          <span className={msg.isEnhancing || msg.status === 'processing' ? 'ai-text-shimmer' : ''}>
                            {msg.isEnhancing
                              ? t.enhancing
                              : msg.status === 'processing'
                                ? t.generating
                                : msg.status === 'preparing'
                                  ? t.startingGeneration
                                  : t.waiting}
                          </span>
                          {!msg.isEnhancing && msg.status === 'processing' && (
                            <span className="generation-live-timer">
                              {formatDuration(getGenerationElapsedSeconds(
                                msg.duration,
                                msg.generationStartedAt,
                                timerNow
                              ))}
                              <GenerationProgress message={msg} />
                            </span>
                          )}
                        </p>
                      </div>

                      <button className="cancel-gen-btn" onClick={interruptGeneration} title="Annuler la génération">
                        <div className="stop-icon-small"></div>
                        <span>{t.cancel}</span>
                      </button>
                    </div>
                  )}

                  {msg.role === 'bot' && msg.status === 'failed' && (
                    <div className="generation-error-container">
                      <div className="error-icon">⚠️</div>
                      <div className="error-content">
                        <p className="error-title">{t.genFailed}</p>
                        <p className="error-details">{msg.text}</p>
                        <div className="retry-actions">
                          <button className="retry-btn" onClick={async () => {
                            try {
                              if (msg.id.startsWith('temp-')) {
                                const prompt = msg.generationPrompt || msg.prompt || '';
                                if (!prompt.trim()) throw new Error(t.retryFailed);
                                dismissFailedMessage(msg.id);
                                await handleSend(prompt, true, true);
                              } else {
                                await retryMessage(msg.id);
                              }
                              toast.success(t.retryStarted);
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : t.retryFailed);
                            }
                          }}>
                            <span>{t.retry}</span>
                          </button>
                          {msg.id === firstFailedMessageId && (
                            <button className="retry-all-btn" onClick={() => setShowRetryAllConfirm(true)} disabled={isRetryingAll}>
                              {isRetryingAll ? t.retryingAll : t.retryAllIncomplete}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {msg.imageUrl && (
                    <div id={`img-${msg.id}`} className="image-wrapper"
                      style={{
                        aspectRatio: (msg.width && msg.height) ? `${msg.width}/${msg.height}` : 'auto',
                        minHeight: '100px'
                      }}
                      onClick={() => handleImageClick({ 
                        url: msg.imageUrl!, 
                        thumbnailUrl: msg.thumbnailUrl,
                        sessionId: currentSessionId!, 
                        messageId: msg.id, 
                        isFavorite: msg.isFavorite, 
                        source: 'chat' 
                      })}
                    >
                      <img 
                        src={getFullImageUrl(msg.thumbnailUrl || msg.imageUrl!)} 
                        alt="Generated" 
                        className="clickable-image" 
                        loading="lazy"
                        decoding="async"
                        style={{ width: '100%', height: 'auto', display: 'block' }}
                        // Removed onLoad scroll to prevent jumps during polling
                      />
                      <button 
                        className={`image-fav-btn ${msg.isFavorite ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(currentSessionId!, msg.id, msg.isFavorite); }}
                        title={t.favorites}
                      >
                        {msg.isFavorite ? '❤️' : '🤍'}
                      </button>
                      {favoritedId === msg.id && <div className="image-overlay-heart">❤️</div>}
                      {msg.comparisonMessageId && (
                        <button
                          className="image-comparison-badge"
                          onClick={(event) => { event.stopPropagation(); openComparison(msg.id); }}
                          title={lang === 'fr' ? 'Voir la comparaison' : 'View comparison'}
                          aria-label={lang === 'fr' ? 'Voir la comparaison' : 'View comparison'}
                        >A/B</button>
                      )}
                    </div>
                  )}
                  <div className={`message-actions ${msg.imageUrl ? 'has-image' : ''} ${(regenerationCounts[msg.id] || 0) >= 2 ? 'has-regeneration-count' : ''}`}>
                    <button className="action-btn-icon edit" onClick={() => {
                      const textToEdit = msg.role === 'user' ? (msg.text || '') : (msg.generationPrompt || msg.prompt || msg.text || '');
                      if (editablePendingMessage) {
                        setPendingPromptEditor({
                          displayMessageId: msg.id,
                          targetMessageId: editablePendingMessage.id,
                          localUserMessageId: msg.role === 'user' ? msg.id : undefined,
                        });
                        setPendingPromptDraft(textToEdit);
                      } else {
                        handleEdit(textToEdit);
                      }
                    }} title={editablePendingMessage ? t.editPendingPrompt : (msg.role === 'bot' ? t.reusePrompt : t.edit)}>✎</button>
                    {canRegenerateDynamicPrompt && (
                      <button
                        className="action-btn-icon regenerate"
                        onClick={(e) => {
                          e.stopPropagation();
                          recordRegeneration(msg.id);
                          handleSend(dynamicPrompt, true);
                        }}
                        title={t.regenerateDynamicPrompt}
                        aria-label={`${t.regenerateDynamicPrompt}${(regenerationCounts[msg.id] || 0) >= 2 ? ` ×${regenerationCounts[msg.id]}` : ''}`}
                      >
                        <RefreshIcon />
                        {(regenerationCounts[msg.id] || 0) >= 2 && (
                          <span className="regeneration-count-badge" aria-hidden="true">
                            ×{regenerationCounts[msg.id]}
                          </span>
                        )}
                      </button>
                    )}
                    {msg.imageUrl && (
                      <>
                        <button
                          className={`action-btn-icon prompt-like ${msg.isPromptFavorite ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePromptFavorite(currentSessionId!, msg.id, msg.isPromptFavorite);
                          }}
                          title={t.likePrompt}
                          aria-label={t.likePrompt}
                          aria-pressed={msg.isPromptFavorite === 1}
                        >
                          <ThumbUpIcon />
                        </button>
                        <button className="action-btn-icon info" onClick={(e) => { e.stopPropagation(); setActiveInfoId(activeInfoId === msg.id ? null : msg.id); }} title="Info">
                          <InfoIcon />
                        </button>
                        <button className="action-btn-icon download" onClick={(e) => { e.stopPropagation(); downloadImage(getFullImageUrl(msg.imageUrl!), `img-${msg.id}.png`); }} title={t.download}>💾</button>
                        <button
                          className="action-btn-icon regenerate"
                          onClick={(e) => {
                            e.stopPropagation();
                            const prompt = msg.generationPrompt || msg.prompt || msg.text || '';
                            if (!prompt.trim()) return;
                            recordRegeneration(msg.id);
                            handleSend(prompt, true);
                          }}
                          title={t.regenerate}
                          aria-label={`${t.regenerate}${(regenerationCounts[msg.id] || 0) >= 2 ? ` ×${regenerationCounts[msg.id]}` : ''}`}
                        >
                          <RefreshIcon />
                          {(regenerationCounts[msg.id] || 0) >= 2 && (
                            <span className="regeneration-count-badge" aria-hidden="true">
                              ×{regenerationCounts[msg.id]}
                            </span>
                          )}
                        </button>
                      </>
                    )}
                    <button className="action-btn-icon delete" onClick={(e) => { e.stopPropagation(); setMessageToDelete(msg.id); }} title={t.delete}>🗑️</button>
                  </div>
                  {activeInfoId === msg.id && msg.role === 'bot' && (
                    <div className="generation-info-panel">
                      <p><strong>{t.date}:</strong> {new Date(msg.timestamp).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US')}</p>
                      <p><strong>{t.model}:</strong> {msg.model || t.unknown}</p>
                      <p><strong>{t.workflow}:</strong> {msg.workflow || t.unknown}</p>
                      <p><strong>Sampler:</strong> {msg.sampler || t.unknown} | <strong>Scheduler:</strong> {msg.scheduler || t.unknown}</p>
                      <p><strong>{t.dimensions}:</strong> {msg.width}x{msg.height}</p>
                      <p><strong>{t.steps}:</strong> {msg.steps} | <strong>CFG:</strong> {msg.cfg}</p>
                      <p><strong>{t.seed}:</strong> {msg.seed !== undefined && msg.seed !== null ? (
                        <span className="reusable-seed" title={t.reuseSeed} onClick={() => {
                          setParams(prev => ({ ...prev, seedMode: 'fixed', forcedSeed: msg.seed!.toString() }));
                          setShowOptions(true);
                          toast.success(t.reuseSeed);
                        }}>{msg.seed}</span>
                      ) : t.unknown}</p>
                      {msg.duration !== undefined && (
                        <p><strong>{lang === 'fr' ? 'Durée' : 'Duration'}:</strong> {formatDuration(msg.duration)}</p>
                      )}
                      {!!msg.tags?.length && (
                        <div className="prompt-tags" aria-label={t.promptTags}>
                          {msg.tags.map(tag => (
                            <button
                              key={tag.slug}
                              type="button"
                              className={`prompt-tag tag-${tag.category}`}
                              onClick={() => openPromptTag(tag.slug)}
                              title={t.viewTagContents}
                            >
                              {lang === 'fr' ? tag.labelFr : tag.labelEn}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              );
            })}
            {isAnalyzingImage && (
              <div id="vision-analysis-post" className="message-row bot vision-analysis-row" aria-live="polite">
                <div className="avatar vision-avatar"><CameraIcon size={18} /></div>
                <div className="message-content loading">
                  <div className="vision-analysis-stage">
                    <div className={`vision-scan-frame ${analysisPreview ? '' : 'without-preview'}`}>
                      {analysisPreview && <img src={analysisPreview.url} alt="Imported preview" />}
                      <span className="vision-scan-line" aria-hidden="true" />
                      <span className="vision-scan-grid" aria-hidden="true" />
                      <span className="vision-pixel-cloud vision-pixel-cloud-a" aria-hidden="true" />
                      <span className="vision-pixel-cloud vision-pixel-cloud-b" aria-hidden="true" />
                      <span className="vision-frame-corner corner-tl" aria-hidden="true" />
                      <span className="vision-frame-corner corner-tr" aria-hidden="true" />
                      <span className="vision-frame-corner corner-bl" aria-hidden="true" />
                      <span className="vision-frame-corner corner-br" aria-hidden="true" />
                    </div>
                    <div className="vision-analysis-copy">
                      <SeedyCompanion state="magic" settings={params.companionSettings} />
                      <div>
                        <strong>{t.visionAnalysisInProgress || 'Analyse visuelle en cours'}</strong>
                        <span>
                          {t.visionAnalysisDetail || 'Composition · lumière · textures · optique'}
                          {' · '}
                          {formatDuration(Math.max(1, Math.floor((timerNow - analysisStartedAt) / 1000)))}
                        </span>
                      </div>
                      <i className="vision-live-dot" aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </div>
            )}
            {isCreatingLuckyPrompt && (
              <div id="lucky-generation-post" className="message-row bot lucky-generation-row" aria-live="polite">
                <div className="avatar" aria-label={t.luckyPromptAction}>
                  <MagicWandIcon size={19} />
                </div>
                <div className="message-content loading">
                  <div className="generation-placeholder lucky-generation-placeholder">
                    <SeedyCompanion state="magic" settings={params.companionSettings} />
                    <p key={luckyPhraseIndex} className="ai-text-shimmer lucky-magic-phrase">
                      {luckyPhrases[luckyPhraseIndex]}
                    </p>
                    <span className="lucky-magic-caption">{t.luckyPromptCreating}</span>
                  </div>
                </div>
              </div>
            )}
            {isGenerating && messages.length > 0 && !messages[messages.length - 1].role.includes('bot') && (
              <div className="message-row bot">
                <div className="avatar">C</div>
                <div className="message-content loading">
                  <div className="generation-placeholder">
                    <div className="generation-status-line">
                      <SeedyCompanion state={isEnhancing ? 'magic' : 'working'} settings={params.companionSettings} />
                      <p className="ai-text-shimmer">{isEnhancing ? t.enhancing : t.generating}</p>
                    </div>
                    <button className="cancel-gen-btn" onClick={interruptGeneration} title="Annuler la génération">
                      <div className="stop-icon-small"></div>
                      <span>{t.cancel}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        ) : (
          <div className="gallery-view">
            <div className={`gallery-header ${selectedGalleryIds.size ? 'gallery-selection-header' : ''}`}>
              <div className="gallery-title-row">
                <h2>{selectedGalleryIds.size
                  ? `${selectedGalleryIds.size} ${selectedGalleryIds.size === 1 ? t.selected : t.selectedPlural}`
                  : t.myContent}</h2>
                {selectedGalleryIds.size ? (
                  <button type="button" className="gallery-selection-cancel" onClick={clearGallerySelection} disabled={galleryBatchBusy}>
                    {t.cancel}
                  </button>
                ) : (
                  <span className="gallery-result-count">
                    {galleryTotal} {galleryTotal === 1 ? t.result : t.results}
                  </span>
                )}
              </div>
              {!selectedGalleryIds.size && <div className="gallery-filters">
                <div className="gallery-search">
                  <div className={`gallery-search-box ${isGallerySearchFocused ? 'focused' : ''}`}>
                    {selectedPromptTags.map(slug => {
                      const tag = availablePromptTags.find(candidate => candidate.slug === slug);
                      const label = tag ? (lang === 'fr' ? tag.labelFr : tag.labelEn) : slug;
                      return (
                        <span key={slug} className="gallery-search-chip">
                          <span>{label}</span>
                          <button
                            type="button"
                            onClick={() => removePromptTag(slug)}
                            aria-label={`${t.removeTag}: ${label}`}
                            title={t.removeTag}
                          >
                            <XIcon size={12} />
                          </button>
                        </span>
                      );
                    })}
                    <input
                      type="search"
                      value={gallerySearch}
                      onChange={event => setGallerySearch(event.target.value)}
                      onFocus={() => setIsGallerySearchFocused(true)}
                      onBlur={() => setIsGallerySearchFocused(false)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' && matchingPromptTags.length > 0) {
                          event.preventDefault();
                          addPromptTag(matchingPromptTags[0].slug);
                        }
                      }}
                      placeholder={selectedPromptTags.length > 0 ? t.addTagOrSearch : t.searchContents}
                      aria-label={t.searchContents}
                      autoComplete="off"
                    />
                  </div>
                  {isGallerySearchFocused && matchingPromptTags.length > 0 && (
                    <div className="gallery-tag-suggestions" role="listbox" aria-label={t.tagSuggestions}>
                      {matchingPromptTags.map(tag => (
                        <button
                          key={tag.slug}
                          type="button"
                          role="option"
                          aria-selected="false"
                          onMouseDown={event => event.preventDefault()}
                          onClick={() => addPromptTag(tag.slug)}
                        >
                          <span>{lang === 'fr' ? tag.labelFr : tag.labelEn}</span>
                          <small>{tag.count || 0}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button className={`gallery-filter-fav ${favoritesOnly ? 'active' : ''}`} onClick={() => setFavoritesOnly(!favoritesOnly)} aria-pressed={favoritesOnly}>
                  {favoritesOnly ? '❤️' : '🤍'} {t.favorites}
                </button>
                <div className="control-group">
                  <button className={`control-pill ${!showArchivedInGallery ? 'active' : ''}`} onClick={() => setShowArchivedInGallery(false)}>
                    {t.active}
                  </button>
                  <button className={`control-pill ${showArchivedInGallery ? 'active' : ''}`} onClick={() => setShowArchivedInGallery(true)}>
                    {t.archived}
                  </button>
                </div>
              </div>}
            </div>
            <div
              className={`gallery-grid ${isPinchingGallery ? 'is-pinching' : ''}`}
              style={{ gridTemplateColumns: `repeat(${galleryColumns}, minmax(0, 1fr))` }}
              onTouchStart={handleGalleryTouchStart}
              onTouchMove={handleGalleryTouchMove}
              onTouchEnd={handleGalleryTouchEnd}
              onTouchCancel={handleGalleryTouchEnd}
            >
              {isPinchingGallery && (
                <div className="gallery-density-indicator" role="status" aria-live="polite">
                  {galleryColumns} {lang === 'fr'
                    ? (galleryColumns === 1 ? 'colonne' : 'colonnes')
                    : (galleryColumns === 1 ? 'column' : 'columns')}
                </div>
              )}
              {galleryItems.map((item, index) => (
                <div 
                  ref={galleryItems.length === index + 1 ? lastImageElementRef : undefined}
                  key={item.messageId} 
                  className={`gallery-item ${selectedGalleryIds.has(item.messageId) ? 'selected' : ''}`}
                  style={{ 
                    aspectRatio: (item.width && item.height) ? `${item.width}/${item.height}` : 'auto',
                    backgroundColor: 'var(--social-bg)'
                  }}
                  aria-pressed={selectedGalleryIds.size ? selectedGalleryIds.has(item.messageId) : undefined}
                  onPointerDown={event => startGalleryLongPress(event, item.messageId)}
                  onPointerMove={moveGalleryLongPress}
                  onPointerUp={event => cancelGalleryLongPress(event.pointerId)}
                  onPointerCancel={event => cancelGalleryLongPress(event.pointerId)}
                  onPointerLeave={event => cancelGalleryLongPress(event.pointerId)}
                  onContextMenu={event => event.preventDefault()}
                  onClick={(event) => {
                    if (suppressGalleryClickRef.current) return;
                    if (event.shiftKey && !selectedGalleryIds.size) {
                      gallerySelectionModeRef.current = true;
                      setSelectedGalleryIds(new Set([item.messageId]));
                      return;
                    }
                    if (gallerySelectionModeRef.current || selectedGalleryIds.size) {
                      toggleGallerySelection(item.messageId);
                      return;
                    }
                    handleImageClick({
                      url: item.imageUrl,
                      thumbnailUrl: item.thumbnailUrl,
                      sessionId: item.sessionId,
                      messageId: item.messageId,
                      isFavorite: item.isFavorite,
                      source: 'gallery'
                    });
                  }}
                >
                  <img 
                    src={getFullImageUrl(item.thumbnailUrl || item.imageUrl)} 
                    alt={item.prompt} 
                    loading="lazy"
                    decoding="async"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  {galleryColumns < 3 && selectedGalleryIds.size === 0 && (
                    <div className="gallery-item-actions">
                      <button
                        className="gallery-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(item.generationPrompt || item.prompt || item.text || '');
                        }}
                        title={t.reusePrompt}
                        aria-label={t.reusePrompt}
                      >
                        <ComposeIcon size={18} />
                      </button>
                      <button
                        className="gallery-action-btn"
                        onClick={(e) => { e.stopPropagation(); goToImage(item.sessionId, item.messageId); }}
                        title={t.viewInChat}
                      >
                        <ChatIcon size={18} />
                      </button>
                    </div>
                  )}
                  {item.isFavorite === 1 && <div className="gallery-item-favorite">❤️</div>}
                  {item.isPromptFavorite === 1 && (
                    <div className="gallery-item-prompt-favorite" title={t.likePrompt}>
                      <ThumbUpIcon size={18} />
                    </div>
                  )}
                  {item.comparisonMessageId && selectedGalleryIds.size === 0 && (
                    <button
                      className="gallery-item-comparison"
                      onClick={(event) => { event.stopPropagation(); openComparison(item.messageId); }}
                      title={lang === 'fr' ? 'Voir la comparaison' : 'View comparison'}
                    >A/B</button>
                  )}
                  {selectedGalleryIds.size > 0 && (
                    <span className="gallery-selection-checkbox" aria-hidden="true">
                      {selectedGalleryIds.has(item.messageId) && (
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m4 10 4 4 8-9" /></svg>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {galleryItems.length === 0 && !isFetchingGallery && <p className="empty-gallery">Aucun contenu généré pour le moment.</p>}
            {isFetchingGallery && <div className="gallery-loader-container"><div className="typing-indicator"><span></span><span></span><span></span></div></div>}
            {selectedGalleryIds.size > 0 && (
              <div className="gallery-batch-bar">
                <button
                  type="button"
                  className="gallery-batch-action"
                  aria-haspopup="menu"
                  aria-expanded={galleryBatchMenuOpen}
                  disabled={galleryBatchBusy}
                  onClick={() => setGalleryBatchMenuOpen(open => !open)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
                  <span>{t.actions}</span>
                  <b>{selectedGalleryIds.size}</b>
                </button>
                {galleryBatchMenuOpen && (
                  <div className="gallery-batch-menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => void runGalleryBatchAction(
                      () => batchRegenerateGalleryItems(selectedGalleryItems),
                      `${selectedGalleryItems.length} ${t.batchQueued}`
                    )} disabled={galleryBatchBusy}>
                      <span className="gallery-batch-menu-icon"><RefreshIcon size={20} /></span>
                      <span><strong>{t.batchRegenerate}</strong><small>{t.batchRegenerateHelp}</small></span>
                    </button>
                    <button type="button" role="menuitem" onClick={() => void runGalleryBatchAction(
                      () => batchLuckyGalleryItems(selectedGalleryItems)
                    )} disabled={galleryBatchBusy || selectedGalleryItems.length > 8}>
                      <span className="gallery-batch-menu-icon"><MagicWandIcon size={20} /></span>
                      <span><strong>{t.batchLucky}</strong><small>{selectedGalleryItems.length > 8 ? t.batchLuckyLimit : t.batchLuckyHelp}</small></span>
                    </button>
                    <button type="button" role="menuitem" onClick={() => void runGalleryBatchAction(
                      () => batchSetGalleryFavorites(selectedGalleryItems, selectedAreAllFavorites ? 0 : 1),
                      selectedAreAllFavorites ? t.batchFavoritesRemoved : t.batchFavoritesAdded
                    )} disabled={galleryBatchBusy}>
                      <span className="gallery-batch-menu-icon gallery-batch-heart" aria-hidden="true">{selectedAreAllFavorites ? '♡' : '♥'}</span>
                      <span><strong>{selectedAreAllFavorites ? t.batchRemoveFavorites : t.batchAddFavorites}</strong><small>{t.batchFavoritesHelp}</small></span>
                    </button>
                    <button type="button" role="menuitem" onClick={() => void runGalleryBatchAction(
                      () => batchSetGalleryPromptFavorites(selectedGalleryItems, selectedAreAllPromptFavorites ? 0 : 1),
                      selectedAreAllPromptFavorites ? t.batchPromptsUnliked : t.batchPromptsLiked
                    )} disabled={galleryBatchBusy}>
                      <span className="gallery-batch-menu-icon"><ThumbUpIcon size={20} /></span>
                      <span><strong>{selectedAreAllPromptFavorites ? t.batchUnlikePrompts : t.batchLikePrompts}</strong><small>{t.batchPromptFavoritesHelp}</small></span>
                    </button>
                    <button type="button" role="menuitem" className="danger" onClick={() => {
                      const confirmed = window.confirm(`${t.batchDeleteConfirm} (${selectedGalleryItems.length})`);
                      if (confirmed) void runGalleryBatchAction(
                        () => batchDeleteGalleryItems(selectedGalleryItems),
                        `${selectedGalleryItems.length} ${t.batchDeleted}`
                      );
                    }} disabled={galleryBatchBusy}>
                      <span className="gallery-batch-menu-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14" /></svg>
                      </span>
                      <span><strong>{t.delete}</strong><small>{t.batchDeleteHelp}</small></span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {view === 'chat' && (
        <div className="input-container">
          {showOptions && (
            <div ref={optionsDrawerRef} className="generation-options-drawer fadeIn">
              <div className="options-group lucky-prompt-group">
                <input
                  ref={imageImportRef}
                  className="vision-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  onChange={event => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void analyzeImportedImage(file);
                  }}
                />
                <div className="lucky-prompt-actions">
                  <button
                    type="button"
                    className="image-import-btn"
                    onClick={() => {
                      if (!params.visionProviderId || !params.visionModel) {
                        toast.error(t.visionSetupRequired || 'Choose a vision provider and model in LLM settings first.');
                        return;
                      }
                      imageImportRef.current?.click();
                    }}
                    disabled={isAnalyzingImage}
                    title={t.importImageHelp || 'Analyze a photo and recreate it from a detailed prompt'}
                  >
                    <CameraIcon size={17} />
                    <span>{isAnalyzingImage ? (t.visionScanning || 'Scanning…') : (t.importImage || 'Import photo')}</span>
                  </button>
                  <div className="lucky-prompt-action-with-info">
                    <button
                      type="button"
                      className="lucky-prompt-btn"
                      onClick={() => {
                        setShowOptions(false);
                        void createLuckyGeneration();
                      }}
                      disabled={isCreatingLuckyPrompt || isLoadingLuckyReferences}
                    >
                      <MagicWandIcon size={17} className="lucky-prompt-icon" />
                      <span>{isLoadingLuckyReferences ? t.luckyReferencesLoading : (isCreatingLuckyPrompt ? t.luckyPromptCreating : t.luckyPromptAction)}</span>
                    </button>
                    <button
                      type="button"
                      className={`lucky-info-btn ${showLuckyInfo ? 'active' : ''}`}
                      onClick={() => setShowLuckyInfo(current => !current)}
                      aria-label={t.luckyInfoLabel}
                      aria-expanded={showLuckyInfo}
                      aria-controls="lucky-prompt-explanation"
                      title={t.luckyInfoLabel}
                    >
                      <InfoIcon size={14} />
                    </button>
                  </div>
                </div>
                {showLuckyInfo && (
                  <p id="lucky-prompt-explanation" className="lucky-prompt-explanation">
                    {t.luckyInfoText}
                  </p>
                )}
              </div>
              <div className="options-group">
                <div className="option-label">{t.seed}</div>
                <div className="option-controls">
                  <button 
                    className={`option-badge ${params.seedMode === 'random' ? 'active' : ''}`}
                    onClick={() => setParams({ ...params, seedMode: 'random' })}
                  >
                    🎲 {t.random}
                  </button>
                  <button 
                    className={`option-badge ${params.seedMode === 'fixed' ? 'active' : ''}`}
                    onClick={() => setParams({ ...params, seedMode: 'fixed' })}
                  >
                    🔒 {t.fixed}
                  </button>
                  {params.seedMode === 'fixed' && (
                    <input 
                      type="text" 
                      className="option-input seed-input" 
                      value={params.forcedSeed} 
                      onChange={(e) => setParams({ ...params, forcedSeed: e.target.value.replace(/\D/g, '') })}
                      placeholder="Graine..."
                    />
                  )}
                </div>
              </div>
              {params.randomPromptLists.some(list => list.enabled && list.slug && list.values.some(value => value.trim())) && (
                <div className="options-group random-prompts-options">
                  <div className="option-label">🎲 {t.randomLists}</div>
                  <div className="random-prompts-quickbar" role="list" aria-label={t.randomLists}>
                    {params.randomPromptLists
                      .filter(list => list.enabled && list.slug && list.values.some(value => value.trim()))
                      .map(list => (
                        <button
                          key={list.id}
                          type="button"
                          className="random-prompt-chip"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => insertRandomSlug(list.slug)}
                          title={`${t.insertRandomSlug} [${list.slug}]`}
                        >
                          <span className="random-prompt-chip-name">{list.name}</span>
                          <span className="random-prompt-chip-slug">+ [{list.slug}]</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="input-wrapper">
            {showScrollBottom && !showOptions && (
              <button className="scroll-bottom-btn" onClick={onScrollToBottom} title={lang === 'fr' ? 'Aller en bas' : 'Scroll to bottom'}>
                <ChevronDownIcon size={24} />
              </button>
            )}
            {showSlashCommandMenu && (
              <div id="slash-command-menu" className="slash-command-menu" role="listbox" aria-label={t.slashCommands}>
                {matchingSlashCommands.map((command, index) => (
                  <button
                    key={command.name}
                    type="button"
                    className={`slash-command-option ${index === slashCommandIndex ? 'active' : ''}`}
                    role="option"
                    aria-selected={index === slashCommandIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertSlashCommand(command.name)}
                  >
                    <span className="slash-command-name">/{command.name}</span>
                    <span className="slash-command-details">
                      <strong>{command.usage}</strong>
                      <small>{command.description}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className={`input-box ${params.llmEnabled ? 'ai-active' : ''} ${input ? 'has-text' : ''} ${hasRandomCodes ? 'has-random-code' : ''}`}>
              {!input && (
                <button
                  ref={optionsToggleRef}
                  type="button"
                  className={`options-toggle-btn ${showOptions ? 'active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setShowOptions(!showOptions)}
                  title={t.options}
                  aria-label={t.options}
                  aria-expanded={showOptions}
                >
                  <PlusIcon size={20} />
                </button>
              )}
              <div className="prompt-editor">
                {hasRandomCodes && (
                  <div ref={promptHighlightRef} className="prompt-highlight-layer" aria-hidden="true">
                    {promptParts.map((part, index) => {
                      const isRandomCode = part.startsWith('[')
                        && part.endsWith(']')
                        && enabledRandomSlugs.has(part.slice(1, -1).toLowerCase());
                      return isRandomCode
                        ? <mark className="prompt-random-code" key={`${part}-${index}`}>{part}</mark>
                        : <React.Fragment key={`${index}-${part.length}`}>{part}</React.Fragment>;
                    })}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onFocus={() => setIsPromptFocused(true)}
                  onBlur={() => setIsPromptFocused(false)}
                  onScroll={(e) => syncPromptHighlightScroll(e.currentTarget)}
                  onKeyDown={handlePromptKeyDown}
                  aria-autocomplete="list"
                  aria-controls={showSlashCommandMenu ? 'slash-command-menu' : undefined}
                  aria-expanded={showSlashCommandMenu}
                  placeholder={params.llmEnabled ? t.aiPlaceholder : t.placeholder}
                  rows={1}
                />
              </div>
              <div className="input-box-actions">
                {input && (
                  <button
                    ref={optionsToggleRef}
                    type="button"
                    className={`options-toggle-btn ${showOptions ? 'active' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setShowOptions(!showOptions)}
                    title={t.options}
                    aria-label={t.options}
                    aria-expanded={showOptions}
                  >
                    <PlusIcon size={20} />
                  </button>
                )}
                <div className="input-box-actions-end">
                  {input && (
                    <button className="clear-input-btn" onClick={() => setInput('')} title="Effacer le texte">
                      <XIcon size={18} />
                    </button>
                  )}
                  {input && (
                    <button
                      type="button"
                      className="one-shot-ai-btn"
                      onClick={() => handleSend(undefined, false, false, true)}
                      disabled={!input.trim() || !params.llmProviderId}
                      title={params.llmProviderId ? t.oneShotAi : t.oneShotAiUnavailable}
                      aria-label={params.llmProviderId ? t.oneShotAi : t.oneShotAiUnavailable}
                    >
                      AI
                    </button>
                  )}
                  <button
                    className={`send-btn ${isGenerating && !input.trim() ? 'stop-btn' : ''}`}
                    onClick={() => isGenerating && !input.trim() ? interruptGeneration() : void executePromptInput()}
                    disabled={(!input.trim() && !isGenerating) || isResolvingSlashCommand}
                  >
                    {isGenerating && !input.trim() ? (
                      <div className="stop-icon"></div>
                    ) : (
                      <SendIcon />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {showRetryAllConfirm && (
        <div className="settings-modal-overlay" onClick={() => setShowRetryAllConfirm(false)}>
          <div className="settings-modal confirm-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h3>{t.confirmRetryAll}</h3>
            <div className="confirm-buttons">
              <button className="confirm-btn archive" onClick={handleRetryAll}>{t.confirm}</button>
              <button className="confirm-btn cancel" onClick={() => setShowRetryAllConfirm(false)}>{t.cancel}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
