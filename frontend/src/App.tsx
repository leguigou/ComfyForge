import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import './App.css';
import { translations } from './i18n';
import type { 
  GalleryItem, 
  GenParameters, 
  Theme, 
  Language,
  User,
  PromptTag,
  LuckyReference
} from './types';
import type { AppView } from './types';
import { API_BASE, getFullImageUrl } from './services/api';
import { Sidebar } from './components/sidebar/Sidebar';
import { SettingsModal } from './components/settings/SettingsModal';
import { DEFAULT_RANDOM_PROMPT_LISTS, migrateRandomPromptLists, RANDOM_PROMPT_LISTS_VERSION } from './utils/randomPrompts';
import { DEFAULT_COMPANION_SETTINGS, normalizeCompanionSettings } from './utils/companions';
import { ChatInterface } from './components/chat/ChatInterface';
import { LuckyReferencesModal } from './components/chat/LuckyReferencesModal';
import { StatisticsDashboard } from './components/statistics/StatisticsDashboard';
import { ComparisonView } from './components/comparison/ComparisonView';
import { APP_CONFIG, DEFAULT_LLM_SYSTEM_MESSAGE, DEFAULT_VISION_SYSTEM_MESSAGE, PREVIOUS_DEFAULT_VISION_SYSTEM_MESSAGE } from './config';
import { useAuth } from './hooks/useAuth';
import { useSessions } from './hooks/useSessions';
import { useGeneration } from './hooks/useGeneration';
import { useWebSocket } from './hooks/useWebSocket';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { ComposeIcon, InfoIcon, MoreVerticalIcon, RefreshIcon, ThumbUpIcon, XIcon } from './components/ui/Icons';
import toast, { Toaster } from 'react-hot-toast';
import NoSleep from 'nosleep.js';
import comfyForgeLogo from './assets/comfyforge-logo-v2.png';

const createDefaultGenParameters = (): GenParameters => ({
  width: 896,
  height: 1152,
  steps: 8,
  cfg: 1.1,
  comfyUrl: 'http://127.0.0.1:8188',
  comfyModel: 'dirtyRealism_DMDSAT.safetensors',
  comfyModelType: 'checkpoint',
  llmUrl: '',
  llmModel: 'llama3:latest',
  llmSystemMessage: DEFAULT_LLM_SYSTEM_MESSAGE,
  negativePrompt: "low quality, bad anatomy, malformed, extra limbs, extra fingers, fused fingers, bad hands, poorly drawn hands, missing fingers, fused face, poorly drawn face, asymmetrical, cartoon, anime, 3d, render, watermark, text, logo, swept hair, portrait",
  llmEnabled: false,
  visionProviderId: '',
  visionModel: '',
  visionSystemMessage: DEFAULT_VISION_SYSTEM_MESSAGE,
  visionModelTtlMinutes: 30,
  luckyTemperature: 0.95,
  luckyFavoriteCount: 6,
  workflowFile: 'workflow_lcm.json',
  nodeMapping: { checkpoint: "1", positive: "3", negative: "4", ksampler: "10", latent: "6", save: "99" },
  seedMode: 'random',
  forcedSeed: '',
  favoriteModels: [],
  randomPromptLists: DEFAULT_RANDOM_PROMPT_LISTS,
  randomPromptListsVersion: RANDOM_PROMPT_LISTS_VERSION,
  companionSettings: DEFAULT_COMPANION_SETTINGS
});

function App() {
  const [lang, setLang] = useState<Language>(() => {
    return (localStorage.getItem('lang') as Language) || 'fr';
  });
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme) || 'dark';
  });
  const t = translations[lang];

  const { 
    isAuthenticated, 
    currentUser, 
    loginError, 
    isLoginLoading, 
    login, 
    logout,
    updateProfile
  } = useAuth();

  const [view, setView] = useState<AppView>(() => {
    return (localStorage.getItem('currentView') as AppView) || 'chat';
  });

  const [keepAwake, setKeepAwakeState] = useState<boolean>(() => {
    return localStorage.getItem('keepAwake') === 'true';
  });
  const keepAwakeRef = useRef(keepAwake);
  const noSleepRef = useRef<NoSleep | null>(null);

  useEffect(() => {
    localStorage.setItem('currentView', view);
  }, [view]);

  const enableKeepAwake = useCallback(async () => {
    if (!keepAwakeRef.current || document.visibilityState !== 'visible') return;

    const noSleep = noSleepRef.current ?? new NoSleep();
    noSleepRef.current = noSleep;
    if (noSleep.isEnabled) return;

    try {
      await noSleep.enable();
    } catch (err) {
      // Video-based mobile fallbacks may require a fresh tap after a reload.
      console.error('Keep-awake error:', err);
    }
  }, []);

  const setKeepAwake = useCallback((enabled: boolean) => {
    keepAwakeRef.current = enabled;
    setKeepAwakeState(enabled);
    localStorage.setItem('keepAwake', enabled.toString());

    if (enabled) {
      // Run from the menu tap so mobile browsers allow the native wake lock
      // or the inline-video fallback to start.
      void enableKeepAwake();
    } else {
      noSleepRef.current?.disable();
    }
  }, [enableKeepAwake]);

  useEffect(() => {
    const resumeKeepAwake = () => {
      if (document.visibilityState === 'visible' && keepAwakeRef.current) {
        void enableKeepAwake();
      }
    };

    // A saved preference can use the native API immediately. The pointer
    // listener supplies the gesture required by the mobile fallback on reload.
    resumeKeepAwake();
    document.addEventListener('visibilitychange', resumeKeepAwake);
    document.addEventListener('pointerdown', resumeKeepAwake);

    return () => {
      document.removeEventListener('visibilitychange', resumeKeepAwake);
      document.removeEventListener('pointerdown', resumeKeepAwake);
      noSleepRef.current?.disable();
    };
  }, [enableKeepAwake]);

  const {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    messages,
    setMessages,
    sessionToDelete,
    setSessionToDelete,
    messageToDelete,
    setMessageToDelete,
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    activeInfoId,
    setActiveInfoId,
    fetchSessions,
    createNewSession,
    fetchSessionDetails,
    renameSession,
    deleteSession,
    confirmDeleteSession,
    toggleArchive,
    archiveAllSessions,
    deleteSessions,
    deleteMessage,
    massActionType,
    setMassActionType
  } = useSessions(view, isAuthenticated);

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [comparisonMessageId, setComparisonMessageId] = useState<string | null>(null);
  const [queueRemaining, setQueueRemaining] = useState<number | null>(null);
  const [showQueueIndicator, setShowQueueIndicator] = useState(
    () => sessionStorage.getItem('comfyforge.queueIndicatorLatched') === 'true'
  );
  const [isCreatingLuckyPrompt, setIsCreatingLuckyPrompt] = useState(false);
  const [isLoadingLuckyReferences, setIsLoadingLuckyReferences] = useState(false);
  const [luckyRerollingId, setLuckyRerollingId] = useState<string | null>(null);
  const [luckyReferencePreview, setLuckyReferencePreview] = useState<{
    keywords: string;
    references: LuckyReference[];
    totalCandidates: number;
    guidance: string;
    activeTagSlug: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'companions' | 'profile' | 'images' | 'random' | 'comfy' | 'llm' | 'update' | 'admin' | 'logs'>('images');
  
  const [input, setInput] = useState('');
  const [openOptionsRequest, setOpenOptionsRequest] = useState(0);
  
  const [params, setParams] = useState<GenParameters>(createDefaultGenParameters);
  const lastSavedParamsRef = useRef<string>('');
  const settingsRequestIdRef = useRef(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingAnchorRef = useRef<string | null>(null);
  const [imageAnchorRequest, setImageAnchorRequest] = useState<{ messageId: string; requestId: number } | null>(null);
  const imageAnchorRequestIdRef = useRef(0);
  const isAnchoringRef = useRef<boolean>(false);
  const isProgrammaticScrollRef = useRef<boolean>(false);
  const scrollAnimationFrameRef = useRef<number | null>(null);
  const scrollRequestTimeoutRef = useRef<number | null>(null);
  const restoredScrollContextRef = useRef<string | null>(null);
  const scrollSaveFrameRef = useRef<number | null>(null);

  const smoothScrollTo = useCallback((elementId: string) => {
    if (pendingAnchorRef.current || isAnchoringRef.current) return;

    // Only one scroll animation may control the container at a time. Without
    // this, quick successive generations make independent animations fight
    // over scrollTop and can briefly send the conversation back to the top.
    if (scrollRequestTimeoutRef.current !== null) {
      window.clearTimeout(scrollRequestTimeoutRef.current);
    }
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      scrollAnimationFrameRef.current = null;
    }

    scrollRequestTimeoutRef.current = window.setTimeout(() => {
      scrollRequestTimeoutRef.current = null;
      const el = document.getElementById(elementId);
      const container = containerRef.current;
      if (!el || !container) return;

      const containerRect = container.getBoundingClientRect();
      const elementRect = el.getBoundingClientRect();
      const unclampedTarget = container.scrollTop + elementRect.top - containerRect.top - 40;
      const targetScroll = Math.max(0, Math.min(unclampedTarget, container.scrollHeight - container.clientHeight));
      const startScroll = container.scrollTop;
      const distance = targetScroll - startScroll;

      if (Math.abs(distance) < 50) {
        container.scrollTop = targetScroll;
        return;
      }

      const duration = 1200;
      let start: number | null = null;
      const easeInOutQuart = (t: number, b: number, c: number, d: number) => {
        t /= d / 2;
        if (t < 1) return c / 2 * t * t * t * t + b;
        t -= 2;
        return -c / 2 * (t * t * t * t - 2) + b;
      };
      const animation = (currentTime: number) => {
        if (start === null) start = currentTime;
        const timeElapsed = Math.min(currentTime - start, duration);
        const nextScroll = easeInOutQuart(timeElapsed, startScroll, distance, duration);
        container.scrollTop = nextScroll;
        if (timeElapsed < duration) {
          scrollAnimationFrameRef.current = window.requestAnimationFrame(animation);
        } else {
          container.scrollTop = targetScroll;
          scrollAnimationFrameRef.current = null;
        }
      };
      scrollAnimationFrameRef.current = window.requestAnimationFrame(animation);
    }, 100);
  }, []);

  useEffect(() => () => {
    if (scrollRequestTimeoutRef.current !== null) {
      window.clearTimeout(scrollRequestTimeoutRef.current);
    }
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
    }
  }, []);

  const markSessionAsViewed = useCallback(async (sessionId: string) => {
    setSessions(previous => previous.map(session =>
      session.id === sessionId && session.generationStatus !== 'processing'
        ? { ...session, generationStatus: 'idle' }
        : session
    ));
    try {
      await fetch(`${API_BASE}/api/history/${sessionId}/viewed`, {
        method: 'PATCH',
        credentials: 'include'
      });
    } catch (error) {
      console.error('Error marking session as viewed:', error);
    }
  }, [setSessions]);

  const handleGenerationStatus = useCallback(async (
    sessionId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed'
  ) => {
    const isCurrentlyVisible = document.visibilityState === 'visible'
      && view === 'chat'
      && currentSessionId === sessionId;

    setSessions(previous => previous.map(session => {
      if (session.id !== sessionId) return session;
      return {
        ...session,
        generationStatus: status === 'pending' || status === 'processing'
          ? 'processing'
          : status === 'completed'
            ? (isCurrentlyVisible ? 'idle' : 'unseen')
            : session.generationStatus === 'processing'
              ? 'idle'
              : session.generationStatus
      };
    }));

    if (status === 'completed' && isCurrentlyVisible) {
      await markSessionAsViewed(sessionId);
    }
  }, [currentSessionId, markSessionAsViewed, setSessions, view]);

  useEffect(() => {
    const markCurrentSessionAsViewed = () => {
      if (document.visibilityState === 'visible' && view === 'chat' && currentSessionId) {
        void markSessionAsViewed(currentSessionId);
      }
    };

    markCurrentSessionAsViewed();
    document.addEventListener('visibilitychange', markCurrentSessionAsViewed);
    return () => document.removeEventListener('visibilitychange', markCurrentSessionAsViewed);
  }, [currentSessionId, markSessionAsViewed, view]);

  const { clientIdRef } = useWebSocket(
    isAuthenticated,
    currentSessionId,
    setMessages,
    fetchSessions,
    fetchSessionDetails,
    handleGenerationStatus,
    setQueueRemaining
  );
  const { handleSend, retryMessage, retryAllIncomplete, updatePendingPrompt, interruptGeneration, isEnhancing } = useGeneration(currentSessionId, params, clientIdRef, setMessages, smoothScrollTo, fetchSessions);

  const isGenerating = isEnhancing || messages.some(m => m.role === 'bot' && (m.status === 'pending' || m.status === 'processing'));

  useEffect(() => {
    if (queueRemaining === null) return;
    if (queueRemaining >= 2) {
      setShowQueueIndicator(true);
      sessionStorage.setItem('comfyforge.queueIndicatorLatched', 'true');
    } else {
      setShowQueueIndicator(false);
      sessionStorage.removeItem('comfyforge.queueIndicatorLatched');
    }
  }, [queueRemaining]);

  const [activeLightbox, setActiveLightbox] = useState<{
    url: string;
    thumbnailUrl?: string;
    sessionId: string;
    messageId: string;
    source: 'chat' | 'gallery';
  } | null>(null);
  const [showLightboxMenu, setShowLightboxMenu] = useState(false);
  const [showLightboxPrompt, setShowLightboxPrompt] = useState(false);
  const [showLightboxModify, setShowLightboxModify] = useState(false);
  const [modifyDirection, setModifyDirection] = useState('');
  const [keepModifySeed, setKeepModifySeed] = useState(true);
  const [isModifyingImage, setIsModifyingImage] = useState(false);
  const lightboxChatWasNavigatedRef = useRef(false);

  const closeLightbox = useCallback(() => {
    const lightbox = activeLightbox;
    const shouldRealignChat = lightbox?.source === 'chat' && lightboxChatWasNavigatedRef.current;

    if (shouldRealignChat) {
      if (scrollRequestTimeoutRef.current !== null) {
        window.clearTimeout(scrollRequestTimeoutRef.current);
        scrollRequestTimeoutRef.current = null;
      }
      if (scrollAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollAnimationFrameRef.current);
        scrollAnimationFrameRef.current = null;
      }

      const element = document.getElementById(`img-${lightbox.messageId}`);
      const container = containerRef.current;
      if (element && container) {
        const containerRect = container.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const targetScroll = container.scrollTop + elementRect.top - containerRect.top - 40;
        container.scrollTop = Math.max(
          0,
          Math.min(targetScroll, container.scrollHeight - container.clientHeight)
        );
      }
    }

    setActiveLightbox(null);
    lightboxChatWasNavigatedRef.current = false;
  }, [activeLightbox]);

  const [hdLoaded, setHdLoaded] = useState<string | null>(null);
  const [loadedHdImages, setLoadedHdImages] = useState<Set<string>>(new Set());
  const [regenerationCounts, setRegenerationCounts] = useState<Record<string, number>>({});
  const regenerationCountTimeoutsRef = useRef<Record<string, number>>({});

  const recordRegeneration = useCallback((messageId: string) => {
    setRegenerationCounts(previous => ({
      ...previous,
      [messageId]: (previous[messageId] || 0) + 1
    }));

    const existingTimeout = regenerationCountTimeoutsRef.current[messageId];
    if (existingTimeout) window.clearTimeout(existingTimeout);

    regenerationCountTimeoutsRef.current[messageId] = window.setTimeout(() => {
      setRegenerationCounts(previous => {
        const next = { ...previous };
        delete next[messageId];
        return next;
      });
      delete regenerationCountTimeoutsRef.current[messageId];
    }, 3000);
  }, []);

  useEffect(() => () => {
    Object.values(regenerationCountTimeoutsRef.current).forEach(window.clearTimeout);
  }, []);

  // Pinch-to-zoom states
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomOffset, setZoomOffset] = useState({ x: 0, y: 0 });
  const lightboxImageRef = useRef<HTMLImageElement>(null);
  const touchStartDist = useRef<number | null>(null);
  const lastTouchPos = useRef<{ x: number, y: number } | null>(null);
  const lastPinchMidpoint = useRef<{ x: number, y: number } | null>(null);
  const lightboxTapGesture = useRef<{ x: number; y: number; startedAt: number; moved: boolean } | null>(null);
  const suppressLightboxClickRef = useRef(false);

  const clampLightboxOffset = useCallback((offset: { x: number; y: number }, scale: number) => {
    if (scale <= 1) return { x: 0, y: 0 };
    const image = lightboxImageRef.current;
    const container = image?.parentElement;
    if (!image || !container) return offset;
    const maxX = Math.max(0, (image.offsetWidth * scale - container.clientWidth) / 2);
    const maxY = Math.max(0, (image.offsetHeight * scale - container.clientHeight) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, offset.x)),
      y: Math.max(-maxY, Math.min(maxY, offset.y))
    };
  }, []);

  useEffect(() => {
    if (zoomScale > 1) return;
    setZoomOffset(current => current.x === 0 && current.y === 0 ? current : { x: 0, y: 0 });
    lastTouchPos.current = null;
  }, [zoomScale]);

  // Clear HD state and zoom when lightbox closes
  useEffect(() => {
    if (!activeLightbox) {
      if (hdLoaded !== null) setHdLoaded(null);
      setZoomScale(1);
      setZoomOffset({ x: 0, y: 0 });
      touchStartDist.current = null;
      lastTouchPos.current = null;
      lastPinchMidpoint.current = null;
      lightboxTapGesture.current = null;
      suppressLightboxClickRef.current = false;
    }
    setShowLightboxMenu(false);
    setShowLightboxPrompt(false);
    setShowLightboxModify(false);
    setModifyDirection('');
  }, [activeLightbox, hdLoaded]);

  const handleLightboxTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      lightboxTapGesture.current = null;
      // Start pinching
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDist.current = dist;
      lastPinchMidpoint.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
      };
      lastTouchPos.current = null;
    } else if (e.touches.length === 1 && zoomScale > 1) {
      // Start panning (only if zoomed in)
      lastTouchPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      const target = e.target as HTMLElement;
      lightboxTapGesture.current = target.closest('.lightbox-toolbar, .lightbox-top-actions, .lightbox-prompt-panel, .lightbox-menu')
        ? null
        : { x: e.touches[0].clientX, y: e.touches[0].clientY, startedAt: e.timeStamp, moved: false };
    } else {
      // Swipe logic fallback
      handleTouchStart(e);
    }
  };

  const handleLightboxTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDist.current !== null) {
      e.preventDefault();
      // Pinching
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const midpoint = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
      };
      const scaleChange = dist / touchStartDist.current;
      const boundedScale = Math.min(Math.max(1, zoomScale * scaleChange), 4);
      const newScale = boundedScale < 1.01 ? 1 : boundedScale;
      setZoomScale(newScale);
      const previousMidpoint = lastPinchMidpoint.current;
      if (newScale === 1) {
        setZoomOffset({ x: 0, y: 0 });
      } else if (previousMidpoint) {
        setZoomOffset(previous => clampLightboxOffset({
          x: previous.x + midpoint.x - previousMidpoint.x,
          y: previous.y + midpoint.y - previousMidpoint.y
        }, newScale));
      }
      touchStartDist.current = dist;
      lastPinchMidpoint.current = midpoint;
    } else if (e.touches.length === 1 && lastTouchPos.current && zoomScale > 1) {
      e.preventDefault();
      // Panning
      const deltaX = e.touches[0].clientX - lastTouchPos.current.x;
      const deltaY = e.touches[0].clientY - lastTouchPos.current.y;
      if (lightboxTapGesture.current && Math.hypot(
        e.touches[0].clientX - lightboxTapGesture.current.x,
        e.touches[0].clientY - lightboxTapGesture.current.y
      ) > 8) {
        lightboxTapGesture.current.moved = true;
      }
      setZoomOffset(prev => clampLightboxOffset({ x: prev.x + deltaX, y: prev.y + deltaY }, zoomScale));
      lastTouchPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 1 && zoomScale === 1) {
      // Swipe logic fallback
      handleTouchMove(e);
    }
  };

  const handleLightboxTouchEnd = (e: React.TouchEvent) => {
    const tap = lightboxTapGesture.current;
    if (
      e.touches.length === 0
      && zoomScale > 1
      && tap
      && !tap.moved
      && e.timeStamp - tap.startedAt < 350
    ) {
      setZoomScale(1);
      setZoomOffset({ x: 0, y: 0 });
      suppressLightboxClickRef.current = true;
      window.setTimeout(() => {
        suppressLightboxClickRef.current = false;
      }, 500);
    }
    lightboxTapGesture.current = null;
    touchStartDist.current = null;
    lastPinchMidpoint.current = null;
    lastTouchPos.current = e.touches.length === 1 && zoomScale > 1
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
      : null;
    if (zoomScale === 1) {
      handleTouchEnd();
    }
  };

  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', isAdmin: false });
  const [isAdminLoading, setIsAdminLoading] = useState(false);
  const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
  const [newPasswordValue, setNewPasswordValue] = useState('');

  const fetchAdminUsers = useCallback(async () => {
    if (!currentUser?.isAdmin) return;
    try {
      const res = await fetch(`${API_BASE}/api/users`, { credentials: 'include' });
      const data = await res.json();
      setAdminUsers(data);
    } catch (err) { console.error('Error fetching users:', err); }
  }, [currentUser]);

  const handleAddUser = useCallback(async () => {
    if (!newUser.username || !newUser.password) return;
    setIsAdminLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
        credentials: 'include'
      });
      if (res.ok) {
        setNewUser({ username: '', password: '', isAdmin: false });
        fetchAdminUsers();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to add user');
      }
    } catch (err) { console.error('Error adding user:', err); }
    finally { setIsAdminLoading(false); }
  }, [newUser, fetchAdminUsers]);

  const internalDeleteUser = useCallback(async (id: string) => {
    if (!confirm(t.confirmDeleteUser)) return;
    try {
      const res = await fetch(`${API_BASE}/api/users/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) fetchAdminUsers();
    } catch (err) { console.error('Error deleting user:', err); }
  }, [t.confirmDeleteUser, fetchAdminUsers]);

  const handleResetPassword = useCallback(async (id: string) => {
    if (!newPasswordValue.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/users/${id}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPasswordValue.trim() }),
        credentials: 'include'
      });
      if (res.ok) {
        alert(lang === 'fr' ? 'Mot de passe mis à jour !' : 'Password updated successfully!');
        setResetPasswordId(null);
        setNewPasswordValue('');
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update password');
      }
    } catch (err) { console.error('Error resetting password:', err); }
  }, [newPasswordValue, lang]);

  useEffect(() => {
    if (activeTab === 'admin') {
      fetchAdminUsers();
    }
  }, [activeTab, fetchAdminUsers]);

  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [galleryTotal, setGalleryTotal] = useState(0);
  const galleryItemsRef = useRef<GalleryItem[]>([]);
  const [hasMoreGallery, setHasMoreGallery] = useState(true);
  const hasMoreGalleryRef = useRef(true);
  const [isFetchingGallery, setIsFetchingGallery] = useState(false);
  const isFetchingGalleryRef = useRef(false);
  const galleryFetchPromiseRef = useRef<Promise<GalleryItem[]> | null>(null);
  const [showArchivedInGallery, setShowArchivedInGallery] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [availablePromptTags, setAvailablePromptTags] = useState<PromptTag[]>([]);
  const [selectedPromptTags, setSelectedPromptTags] = useState<string[]>([]);
  const [gallerySearch, setGallerySearch] = useState('');
  const [debouncedGallerySearch, setDebouncedGallerySearch] = useState('');
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);
  const [isSettingsResolved, setIsSettingsResolved] = useState(false);
  const [favoritedId, setFavoritedId] = useState<string | null>(null);
  const clickTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    galleryItemsRef.current = galleryItems;
  }, [galleryItems]);

  const toggleFavorite = useCallback(async (sessionId: string, messageId: string, currentStatus: number | undefined) => {
    const newStatus = currentStatus === 1 ? 0 : 1;
    if (newStatus === 1) {
      setFavoritedId(messageId);
      setTimeout(() => setFavoritedId(null), 800);
    }
    try {
      const res = await fetch(`${API_BASE}/api/history/${sessionId}/message/${messageId}/favorite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite: newStatus }),
        credentials: 'include'
      });
      if (res.ok) {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isFavorite: newStatus } : m));
        setGalleryItems(prev => favoritesOnly && newStatus === 0
          ? prev.filter(m => m.messageId !== messageId)
          : prev.map(m => m.messageId === messageId ? { ...m, isFavorite: newStatus } : m));
      }
    } catch (err) { console.error('Error toggling favorite:', err); }
  }, [setMessages, favoritesOnly]);

  const togglePromptFavorite = useCallback(async (sessionId: string, messageId: string, currentStatus: number | undefined) => {
    const newStatus = currentStatus === 1 ? 0 : 1;
    try {
      const res = await fetch(`${API_BASE}/api/history/${sessionId}/message/${messageId}/prompt-favorite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPromptFavorite: newStatus }),
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`Failed to update prompt favorite: ${res.status}`);
      setMessages(prev => prev.map(message => message.id === messageId
        ? { ...message, isPromptFavorite: newStatus }
        : message));
      setGalleryItems(prev => prev.map(item => (
        item.messageId === messageId ? { ...item, isPromptFavorite: newStatus } : item
      )));
      toast.success(newStatus ? t.promptLiked : t.promptUnliked);
    } catch (error) {
      console.error('Error toggling prompt favorite:', error);
      toast.error(t.promptLikeFailed);
    }
  }, [setMessages, t.promptLiked, t.promptUnliked, t.promptLikeFailed]);

  const handleImageClick = useCallback((item: { url: string, thumbnailUrl?: string, sessionId: string, messageId: string, isFavorite?: number, source: 'chat' | 'gallery' }) => {
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      toggleFavorite(item.sessionId, item.messageId, item.isFavorite);
    } else {
      clickTimeoutRef.current = window.setTimeout(() => {
        clickTimeoutRef.current = null;
        lightboxChatWasNavigatedRef.current = false;
        setActiveLightbox({ 
          url: item.url, 
          thumbnailUrl: item.thumbnailUrl, 
          sessionId: item.sessionId, 
          messageId: item.messageId, 
          source: item.source 
        });
      }, 300);
    }
  }, [toggleFavorite]);

  const handleLightboxBackdropClick = useCallback((e: React.MouseEvent) => {
    if (suppressLightboxClickRef.current) {
      suppressLightboxClickRef.current = false;
      e.stopPropagation();
      return;
    }

    closeLightbox();
  }, [closeLightbox]);

  const handleLightboxImageClick = useCallback((e: React.MouseEvent) => {
    if (suppressLightboxClickRef.current) {
      suppressLightboxClickRef.current = false;
      e.stopPropagation();
      return;
    }

    if (e.target === e.currentTarget) {
      closeLightbox();
      return;
    }

    e.stopPropagation();
    if (!activeLightbox) return;
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      const currentItem = activeLightbox.source === 'chat' 
        ? messages.find(m => m.id === activeLightbox.messageId)
        : galleryItems.find(m => m.messageId === activeLightbox.messageId);
      toggleFavorite(activeLightbox.sessionId, activeLightbox.messageId, currentItem?.isFavorite);
    } else {
      clickTimeoutRef.current = window.setTimeout(() => {
        clickTimeoutRef.current = null;
      }, 350);
    }
  }, [activeLightbox, closeLightbox, messages, galleryItems, toggleFavorite]);

  const [comfyModels, setComfyModels] = useState<string[]>([]);
  const [diffusionModels, setDiffusionModels] = useState<string[]>([]);
  const [isFetchingComfyModels, setIsFetchingComfyModels] = useState(false);
  const [comfyStatus, setComfyStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const [comfyCheckStatus, setComfyCheckStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const [isCheckingComfy, setIsCheckingComfy] = useState(false);
  const [availableWorkflows, setAvailableWorkflows] = useState<string[]>([]);

  const testComfyConnection = useCallback(async () => {
    setIsCheckingComfy(true);
    setComfyCheckStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/comfy/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comfyUrl: params.comfyUrl }),
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) setComfyCheckStatus({ type: 'success', msg: t.connectionSuccess });
      else setComfyCheckStatus({ type: 'error', msg: data.error || t.connectionFailed });
    } catch (err) { setComfyCheckStatus({ type: 'error', msg: t.connectionFailed + ': ' + (err instanceof Error ? err.message : String(err)) }); }
    finally { setIsCheckingComfy(false); }
  }, [params.comfyUrl, t.connectionSuccess, t.connectionFailed]);

  const [sidebarOpen, setSidebarOpen] = useState(() => (
    window.innerWidth > 768
      ? localStorage.getItem('desktopSidebarOpen') !== 'false'
      : false
  ));
  const [backendError] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (window.matchMedia('(min-width: 769px)').matches) {
      localStorage.setItem('desktopSidebarOpen', String(sidebarOpen));
    }
  }, [sidebarOpen]);

  const saveChatScrollPosition = useCallback(() => {
    const container = containerRef.current;
    if (!container || view !== 'chat' || !currentSessionId) return;

    const containerRect = container.getBoundingClientRect();
    const messageElements = container.querySelectorAll<HTMLElement>('[id^="msg-"]');
    const anchor = Array.from(messageElements).find(element => (
      element.getBoundingClientRect().bottom > containerRect.top
    ));
    const anchorRect = anchor?.getBoundingClientRect();

    try {
      localStorage.setItem(`comfyforge.scroll.chat.${currentSessionId}`, JSON.stringify({
        top: container.scrollTop,
        atBottom: container.scrollHeight - container.scrollTop - container.clientHeight < 20,
        anchorId: anchor?.id,
        anchorOffset: anchorRect ? anchorRect.top - containerRect.top : undefined
      }));
    } catch {
      // Scroll restoration is a convenience; storage can be unavailable in
      // private browsing without affecting the rest of the application.
    }
  }, [currentSessionId, view]);

  const handleScroll = useCallback((isUserScroll: boolean | React.UIEvent = false) => {
    if (isProgrammaticScrollRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    if (view === 'chat' && currentSessionId && scrollSaveFrameRef.current === null) {
      scrollSaveFrameRef.current = window.requestAnimationFrame(() => {
        scrollSaveFrameRef.current = null;
        saveChatScrollPosition();
      });
    }
    
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    
    if (isAtBottom) {
      setShowScrollBottom(false);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      return;
    }

    if (isUserScroll === true) {
      setShowScrollBottom(false);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      
      scrollTimeoutRef.current = window.setTimeout(() => {
        if (containerRef.current) {
           const atBottom = containerRef.current.scrollHeight - containerRef.current.scrollTop - containerRef.current.clientHeight < 150;
           setShowScrollBottom(!atBottom);
        }
      }, 300);
    } else {
      setShowScrollBottom(true);
    }
  }, [currentSessionId, saveChatScrollPosition, view]);

  // Force scroll check when content changes
  useEffect(() => {
    const timer = setTimeout(() => handleScroll(false), 100);
    return () => clearTimeout(timer);
  }, [messages, view, handleScroll]);

  const fetchComfyModels = useCallback(async () => {
    setIsFetchingComfyModels(true);
    setComfyStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/comfy/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comfyUrl: params.comfyUrl }),
        credentials: 'include'
      });
      const data = await res.json();
      if (data.models) {
        const checkpoints = data.checkpoints || data.models || [];
        const diffusion = data.diffusionModels || [];
        setComfyModels(checkpoints);
        setDiffusionModels(diffusion);
        setComfyStatus({ type: 'success', msg: `${checkpoints.length + diffusion.length} ${t.modelsFound}` });
        setParams(p => {
          const selectedList = p.comfyModelType === 'diffusion' ? diffusion : checkpoints;
          if (selectedList.includes(p.comfyModel)) return p;
          if (selectedList.length > 0) return { ...p, comfyModel: selectedList[0] };
          if (checkpoints.length > 0) return { ...p, comfyModelType: 'checkpoint', comfyModel: checkpoints[0] };
          if (diffusion.length > 0) return { ...p, comfyModelType: 'diffusion', comfyModel: diffusion[0] };
          return p;
        });
      }
    } catch (err) { setComfyStatus({ type: 'error', msg: 'Scan échoué : ' + (err instanceof Error ? err.message : String(err)) }); }
    finally { setIsFetchingComfyModels(false); }
  }, [params.comfyUrl, t.modelsFound]);

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/workflows`, { credentials: 'include' });
      const data = await res.json();
      setAvailableWorkflows(data);
    } catch (err) { console.error('Error fetching workflows:', err); }
  }, []);

  const fetchSettings = useCallback(async () => {
    const requestId = ++settingsRequestIdRef.current;
    setIsSettingsResolved(false);
    try {
      const res = await fetch(`${API_BASE}/api/settings`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to fetch settings: ${res.status}`);
      const data = await res.json();
      if (settingsRequestIdRef.current !== requestId) return;
      if (data && data.width) {
        setParams(prev => {
          const storedParams = {
            ...prev,
            ...data,
            luckyTemperature: typeof data.luckyTemperature === 'number'
              ? Math.min(1, Math.max(0.1, data.luckyTemperature))
              : prev.luckyTemperature,
            luckyFavoriteCount: typeof data.luckyFavoriteCount === 'number'
              ? Math.min(8, Math.max(1, Math.round(data.luckyFavoriteCount)))
              : prev.luckyFavoriteCount,
            favoriteModels: data.favoriteModels || prev.favoriteModels,
            randomPromptLists: data.randomPromptLists || prev.randomPromptLists,
            companionSettings: normalizeCompanionSettings(data.companionSettings || prev.companionSettings),
            visionSystemMessage: typeof data.visionSystemMessage !== 'string'
              || !data.visionSystemMessage.trim()
              || data.visionSystemMessage === PREVIOUS_DEFAULT_VISION_SYSTEM_MESSAGE
              ? DEFAULT_VISION_SYSTEM_MESSAGE
              : data.visionSystemMessage,
            visionModelTtlMinutes: [15, 30, 60, 120].includes(data.visionModelTtlMinutes)
              ? data.visionModelTtlMinutes
              : 30
          };
          lastSavedParamsRef.current = JSON.stringify(storedParams);
          return {
            ...storedParams,
            randomPromptLists: migrateRandomPromptLists(storedParams.randomPromptLists, data.randomPromptListsVersion),
            randomPromptListsVersion: RANDOM_PROMPT_LISTS_VERSION
          };
        });
      }
      // Never enable autosave before the server settings were read successfully.
      // Otherwise a transient loading error can overwrite custom companions with defaults.
      setIsSettingsLoaded(true);
    } catch (err) {
      if (settingsRequestIdRef.current === requestId) {
        console.error('Error fetching settings:', err);
      }
    } finally {
      if (settingsRequestIdRef.current === requestId) {
        setIsSettingsResolved(true);
      }
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated === true) return;
    settingsRequestIdRef.current += 1;
    lastSavedParamsRef.current = '';
    setIsSettingsLoaded(false);
    setIsSettingsResolved(false);
    setParams(createDefaultGenParameters());
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchSessions();
      fetchSettings();
    }
  }, [isAuthenticated, fetchSessions, fetchSettings]);

  useEffect(() => {
    if (isAuthenticated && showSettings) {
      fetchComfyModels();
      fetchWorkflows();
    }
  }, [isAuthenticated, showSettings, fetchComfyModels, fetchWorkflows]);

  const saveSettings = useCallback(async (newParams: GenParameters, silent = false) => {
    if (!isSettingsLoaded) return;
    
    // Stringify to compare content
    const paramsString = JSON.stringify(newParams);
    if (paramsString === lastSavedParamsRef.current) return;

    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: paramsString,
        credentials: 'include'
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `${t.settingsSaveFailed} (${res.status})`);
      }
      lastSavedParamsRef.current = paramsString;
      if (!silent) {
        toast.success(t.settingsSaved, { id: 'settings-save' });
      }
    } catch (err) {
      console.error('Error saving settings:', err);
      toast.error(err instanceof Error ? err.message : t.settingsSaveFailed, { id: 'settings-save' });
    }
  }, [isSettingsLoaded, t.settingsSaved, t.settingsSaveFailed]);

  useEffect(() => {
    if (!isAuthenticated || !isSettingsLoaded) return;
    
    // On first load after settings are fetched, initialize the ref without showing toast
    if (!lastSavedParamsRef.current) {
      lastSavedParamsRef.current = JSON.stringify(params);
      return;
    }

    const timer = setTimeout(() => saveSettings(params, !showSettings), 1000);
    return () => clearTimeout(timer);
  }, [params, isAuthenticated, isSettingsLoaded, saveSettings, showSettings]);

  useEffect(() => {
    localStorage.setItem('lang', lang);
  }, [lang]);

  useEffect(() => {
    let interval: number | undefined;
    if (isGenerating && currentSessionId && !isEnhancing) {
      interval = window.setInterval(() => fetchSessionDetails(currentSessionId), 3000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isGenerating, currentSessionId, fetchSessionDetails, isEnhancing]);

  useEffect(() => {
    if (!sessions.some(session => session.generationStatus === 'processing')) return;
    const interval = window.setInterval(fetchSessions, 3000);
    return () => window.clearInterval(interval);
  }, [fetchSessions, sessions]);

  useEffect(() => {
    if (sidebarOpen) {
      void fetchSessions();
    }
  }, [fetchSessions, sidebarOpen]);

  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const handleLogout = useCallback(async () => {
    await logout();
    setSessions([]);
    setCurrentSessionId(null);
    setMessages([]);
    setGalleryItems([]);
    setAdminUsers([]);
    setView('chat');
  }, [logout, setSessions, setCurrentSessionId, setMessages]);

  const galleryOffsetRef = useRef(0);
  const galleryRequestRef = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedGallerySearch(gallerySearch.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [gallerySearch]);

  const fetchPromptTags = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/gallery/tags`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to fetch tags: ${res.status}`);
      const data = await res.json();
      setAvailablePromptTags(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching prompt tags:', error);
    }
  }, []);

  useLayoutEffect(() => {
    if (view !== 'chat' || !currentSessionId) {
      restoredScrollContextRef.current = null;
      return;
    }

    const context = `chat:${currentSessionId}`;
    if (restoredScrollContextRef.current === context || messages.length === 0) return;

    const container = containerRef.current;
    if (!container) return;
    restoredScrollContextRef.current = context;

    let saved: {
      top?: number;
      atBottom?: boolean;
      anchorId?: string;
      anchorOffset?: number;
    } | null;

    try {
      const raw = localStorage.getItem(`comfyforge.scroll.chat.${currentSessionId}`);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      return;
    }
    if (!saved) return;

    if (scrollRequestTimeoutRef.current !== null) {
      window.clearTimeout(scrollRequestTimeoutRef.current);
      scrollRequestTimeoutRef.current = null;
    }
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      scrollAnimationFrameRef.current = null;
    }

    isProgrammaticScrollRef.current = true;
    const previousScrollBehavior = container.style.scrollBehavior;
    container.style.scrollBehavior = 'auto';

    const anchor = saved.anchorId ? document.getElementById(saved.anchorId) : null;
    if (saved.atBottom) {
      container.scrollTop = container.scrollHeight - container.clientHeight;
    } else if (anchor && typeof saved.anchorOffset === 'number') {
      const containerRect = container.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      container.scrollTop += anchorRect.top - containerRect.top - saved.anchorOffset;
    } else if (typeof saved.top === 'number') {
      container.scrollTop = saved.top;
    }

    const frame = window.requestAnimationFrame(() => {
      container.style.scrollBehavior = previousScrollBehavior;
      isProgrammaticScrollRef.current = false;
      handleScroll(false);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      container.style.scrollBehavior = previousScrollBehavior;
      isProgrammaticScrollRef.current = false;
    };
  }, [currentSessionId, handleScroll, messages.length, view]);

  useEffect(() => () => {
    if (scrollSaveFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollSaveFrameRef.current);
    }
  }, []);

  const fetchGallery = useCallback(async (isInitial = false): Promise<GalleryItem[]> => {
    if (!isInitial && isFetchingGalleryRef.current) {
      return galleryFetchPromiseRef.current ?? [];
    }
    if (!isInitial && !hasMoreGalleryRef.current) return [];

    const requestId = isInitial ? ++galleryRequestRef.current : galleryRequestRef.current;
    let resolveFetch!: (items: GalleryItem[]) => void;
    const fetchPromise = new Promise<GalleryItem[]>(resolve => {
      resolveFetch = resolve;
    });
    galleryFetchPromiseRef.current = fetchPromise;
    let loadedItems: GalleryItem[] = [];
    
    isFetchingGalleryRef.current = true;
    setIsFetchingGallery(true);
    
    const currentOffset = isInitial ? 0 : galleryOffsetRef.current;
    try {
      const query = new URLSearchParams({
        limit: '25',
        offset: String(currentOffset),
        includeArchived: String(showArchivedInGallery),
        favoritesOnly: String(favoritesOnly),
        includeTotal: 'true',
      });
      selectedPromptTags.forEach(tag => query.append('tag', tag));
      if (debouncedGallerySearch) query.set('search', debouncedGallerySearch);
      const res = await fetch(`${API_BASE}/api/gallery?${query.toString()}`, { credentials: 'include' });
      if (!res.ok) {
        throw new Error(`Failed to fetch gallery: ${res.status} ${res.statusText}`);
      }
      const responseData = await res.json();
      const data = Array.isArray(responseData) ? responseData : responseData.items;

      if (!Array.isArray(data)) {
        console.error('Gallery API did not return a valid item list:', responseData);
        return [];
      }

      if (requestId !== galleryRequestRef.current) return [];
      if (typeof responseData?.total === 'number') setGalleryTotal(responseData.total);

      if (isInitial) {
        loadedItems = data;
        galleryItemsRef.current = data;
        setGalleryItems(data);
        galleryOffsetRef.current = data.length;
        hasMoreGalleryRef.current = data.length === 25;
        setHasMoreGallery(hasMoreGalleryRef.current);
      } else if (data.length > 0) {
        const existingIds = new Set(galleryItemsRef.current.map(item => item.messageId));
        loadedItems = data.filter(item => !existingIds.has(item.messageId));
        const nextItems = [...galleryItemsRef.current, ...loadedItems];
        galleryItemsRef.current = nextItems;
        setGalleryItems(nextItems);
        galleryOffsetRef.current += data.length;
        hasMoreGalleryRef.current = data.length === 25;
        setHasMoreGallery(hasMoreGalleryRef.current);
      } else {
        hasMoreGalleryRef.current = false;
        setHasMoreGallery(false);
      }
    } catch (err) { 
      console.error('Error fetching gallery:', err); 
    } finally { 
      resolveFetch(loadedItems);
      if (galleryFetchPromiseRef.current === fetchPromise) {
        galleryFetchPromiseRef.current = null;
      }
      if (requestId === galleryRequestRef.current) {
        setIsFetchingGallery(false);
        isFetchingGalleryRef.current = false;
      }
    }
    return loadedItems;
  }, [showArchivedInGallery, favoritesOnly, selectedPromptTags, debouncedGallerySearch]);

  const observer = useRef<IntersectionObserver | null>(null);
  const lastImageElementRef = useCallback((node: HTMLDivElement) => {
    if (isFetchingGallery) return;
    if (observer.current) observer.current.disconnect();
    
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMoreGallery && !isFetchingGalleryRef.current) {
        fetchGallery(false);
      }
    }, { rootMargin: '600px', threshold: 0.1 });
    
    if (node) observer.current.observe(node);
  }, [isFetchingGallery, hasMoreGallery, fetchGallery]);

  const resetGallery = useCallback(() => {
    galleryOffsetRef.current = 0;
    hasMoreGalleryRef.current = true;
    setGalleryItems([]);
    setHasMoreGallery(true);
    fetchGallery(true);
  }, [fetchGallery]);

  const openPromptTag = useCallback((slug: string) => {
    setSelectedPromptTags([slug]);
    setGallerySearch('');
    setFavoritesOnly(false);
    setShowArchivedInGallery(false);
    setActiveInfoId(null);
    setView('gallery');
  }, [setActiveInfoId]);

  const openComparison = useCallback((messageId: string) => {
    setComparisonMessageId(messageId);
    setActiveLightbox(null);
    setShowLightboxMenu(false);
    setView('comparison');
  }, []);

  const openComparisonHome = useCallback(() => {
    setComparisonMessageId(null);
    setView('comparison');
  }, []);

  const activateComparedModel = useCallback((favorite: GenParameters['favoriteModels'][number]) => {
    setParams(current => ({
      ...current,
      comfyModel: favorite.model,
      comfyModelType: favorite.modelType || 'checkpoint',
      workflowFile: favorite.workflowFile || current.workflowFile,
      ...(favorite.generationDefaults || {})
    }));
  }, []);

  useEffect(() => {
    if (view === 'gallery') {
      resetGallery();
      void fetchPromptTags();
    }
  }, [view, showArchivedInGallery, favoritesOnly, selectedPromptTags, debouncedGallerySearch, resetGallery, fetchPromptTags]);

  const goToImage = useCallback((sessionId: string, messageId: string) => {
    pendingAnchorRef.current = messageId;
    isAnchoringRef.current = true;
    imageAnchorRequestIdRef.current += 1;
    setImageAnchorRequest({ messageId, requestId: imageAnchorRequestIdRef.current });

    if (scrollRequestTimeoutRef.current !== null) {
      window.clearTimeout(scrollRequestTimeoutRef.current);
      scrollRequestTimeoutRef.current = null;
    }
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      scrollAnimationFrameRef.current = null;
    }
    isProgrammaticScrollRef.current = false;

    setMessages([]);
    setCurrentSessionId(sessionId);
    setView('chat');
    void fetchSessionDetails(sessionId);
  }, [fetchSessionDetails, setCurrentSessionId, setMessages]);

  useEffect(() => {
    if (view !== 'chat' || !imageAnchorRequest) return;

    const { messageId, requestId } = imageAnchorRequest;
    const startedAt = performance.now();
    let frame: number | null = null;
    let finishTimeout: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let image: HTMLImageElement | null = null;
    let messageElement: HTMLElement | null = null;
    let realignAfterLoad: (() => void) | null = null;
    let cancelled = false;

    const finish = () => {
      if (cancelled) return;
      if (realignAfterLoad) image?.removeEventListener('load', realignAfterLoad);
      resizeObserver?.disconnect();
      messageElement?.classList.remove('highlight-message');
      if (imageAnchorRequestIdRef.current === requestId) {
        pendingAnchorRef.current = null;
        isAnchoringRef.current = false;
        setImageAnchorRequest(null);
      }
    };

    const locateAndAlign = () => {
      if (cancelled) return;

      const element = document.getElementById(`img-${messageId}`)
        ?? document.getElementById(`msg-${messageId}`);
      const container = containerRef.current;

      if (!element || !container) {
        if (performance.now() - startedAt < 5000) {
          frame = window.requestAnimationFrame(locateAndAlign);
        } else {
          finish();
        }
        return;
      }

      const alignImage = () => {
        if (cancelled || !element.isConnected || !container.isConnected) return;
        const containerRect = container.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const offset = elementRect.height >= containerRect.height - 32
          ? 16
          : (containerRect.height - elementRect.height) / 2;
        const targetScroll = Math.max(0, Math.min(
          container.scrollTop + elementRect.top - containerRect.top - offset,
          container.scrollHeight - container.clientHeight
        ));

        container.scrollTop = targetScroll;
      };

      pendingAnchorRef.current = null;
      alignImage();
      image = element.matches('img') ? element as HTMLImageElement : element.querySelector('img');
      messageElement = document.getElementById(`msg-${messageId}`);
      messageElement?.classList.add('highlight-message');

      realignAfterLoad = () => window.requestAnimationFrame(alignImage);
      if (image && !image.complete) image.addEventListener('load', realignAfterLoad, { once: true });
      if ('ResizeObserver' in window) {
        resizeObserver = new ResizeObserver(() => window.requestAnimationFrame(alignImage));
        resizeObserver.observe(element);
      }

      window.requestAnimationFrame(alignImage);
      finishTimeout = window.setTimeout(finish, 2500);
    };

    frame = window.requestAnimationFrame(locateAndAlign);

    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (finishTimeout !== null) window.clearTimeout(finishTimeout);
      if (realignAfterLoad) image?.removeEventListener('load', realignAfterLoad);
      resizeObserver?.disconnect();
      messageElement?.classList.remove('highlight-message');
    };
  }, [view, imageAnchorRequest]);

  const handleEdit = useCallback((text: string) => {
    setInput(text);
    setView('chat');
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const touchStart = useRef<number | null>(null);
  const touchEnd = useRef<number | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => { touchStart.current = e.targetTouches[0].clientX; }, []);
  const handleTouchMove = useCallback((e: React.TouchEvent) => { touchEnd.current = e.targetTouches[0].clientX; }, []);

  const navigateLightbox = useCallback(async (direction: 1 | -1) => {
    if (!activeLightbox) return;

    if (activeLightbox.source === 'chat') {
      const items = messages.filter(message => message.imageUrl);
      const currentIndex = items.findIndex(message => message.id === activeLightbox.messageId);
      if (currentIndex === -1 || items.length < 2) return;
      const nextIndex = (currentIndex + direction + items.length) % items.length;
      const next = items[nextIndex];
      setHdLoaded(null);
      lightboxChatWasNavigatedRef.current = true;
      setActiveLightbox({
        url: next.imageUrl!,
        thumbnailUrl: next.thumbnailUrl,
        sessionId: currentSessionId || '',
        messageId: next.id,
        source: 'chat'
      });
      return;
    }

    const originalMessageId = activeLightbox.messageId;
    let items = galleryItemsRef.current;
    let currentIndex = items.findIndex(item => item.messageId === originalMessageId);
    if (currentIndex === -1) return;

    // Horizontal navigation takes over the vertical grid's lazy-load trigger.
    // Start early so the next page is usually ready before the last loaded image.
    if (direction === 1 && currentIndex >= items.length - 5 && hasMoreGalleryRef.current) {
      void fetchGallery(false);
    }

    if (direction === 1 && currentIndex === items.length - 1 && hasMoreGalleryRef.current) {
      await fetchGallery(false);
      items = galleryItemsRef.current;
      currentIndex = items.findIndex(item => item.messageId === originalMessageId);
    }

    setActiveLightbox(current => {
      if (!current || current.source !== 'gallery' || current.messageId !== originalMessageId) {
        return current;
      }

      let nextIndex = currentIndex + direction;
      if (nextIndex >= items.length) {
        // Once the server confirms the real end, continue as an infinite carousel.
        nextIndex = hasMoreGalleryRef.current ? currentIndex : 0;
      } else if (nextIndex < 0) {
        // Do not jump to a false "last" item while older pages are still unloaded.
        nextIndex = hasMoreGalleryRef.current ? 0 : items.length - 1;
      }

      const next = items[nextIndex];
      if (!next || next.messageId === current.messageId) return current;
      return {
        url: next.imageUrl,
        thumbnailUrl: next.thumbnailUrl,
        sessionId: next.sessionId,
        messageId: next.messageId,
        source: 'gallery'
      };
    });
  }, [activeLightbox, currentSessionId, fetchGallery, messages]);

  const handleTouchEnd = useCallback(() => {
    if (touchStart.current === null || touchEnd.current === null) return;
    const distance = touchStart.current - touchEnd.current;
    if (activeLightbox && Math.abs(distance) > 50) {
      void navigateLightbox(distance > 0 ? 1 : -1);
    }
    touchStart.current = touchEnd.current = null;
  }, [activeLightbox, navigateLightbox]);

  const downloadImage = useCallback(async (url: string, filename: string) => {
    const res = await fetch(url, { credentials: 'include' });
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  }, []);

  const onHandleSend = useCallback(async (
    override?: string,
    regen?: boolean,
    skipEnhancement?: boolean,
    forceEnhancement?: boolean
  ) => {
    const text = override !== undefined ? override : input;
    if (!text.trim()) return;

    let targetSessionId: string | undefined = currentSessionId ?? undefined;
    if (!targetSessionId) {
      targetSessionId = await createNewSession();
    }

    handleSend(text, regen, targetSessionId, skipEnhancement, false, forceEnhancement);
    if (override === undefined) setInput('');
  }, [handleSend, input, currentSessionId, createNewSession]);

  const normalizeLuckyReferences = useCallback((references: LuckyReference[]) => references.map((reference) => ({
    ...reference,
    matchingTags: (reference.tags || []).filter((tag) => (
      tag.category !== 'subject'
      && tag.category !== 'count'
      && references.some((other) => other.messageId !== reference.messageId && (other.tags || []).some((otherTag) => otherTag.slug === tag.slug))
    )),
  })), []);

  const readLuckyError = useCallback((data: { code?: string; error?: string }) => {
    if (data.code === 'NO_LIKED_PROMPTS') return t.luckyNeedsFavorites;
    if (data.code === 'NO_MATCHING_PROMPTS') return t.luckyNoMatches;
    if (data.code === 'NO_COHERENT_REFERENCES') return t.luckyNoCoherentReferences;
    if (data.code === 'NO_LLM_PROVIDER') return t.luckyNeedsProvider;
    return data.error || t.luckyPromptFailed;
  }, [t.luckyNeedsFavorites, t.luckyNeedsProvider, t.luckyNoCoherentReferences, t.luckyNoMatches, t.luckyPromptFailed]);

  const requestLuckyReferences = useCallback(async (
    keywords: string,
    options: { count?: number; excludeIds?: string[]; anchorIds?: string[]; requiredTag?: string } = {}
  ) => {
    const response = await fetch(`${API_BASE}/api/llm/lucky-references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keywords,
        count: options.count ?? params.luckyFavoriteCount,
        excludeIds: options.excludeIds || [],
        anchorIds: options.anchorIds || [],
        requiredTag: options.requiredTag || '',
      }),
      credentials: 'include',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(readLuckyError(data));
    return {
      keywords: typeof data.keywords === 'string' ? data.keywords : keywords,
      references: normalizeLuckyReferences(Array.isArray(data.references) ? data.references : []),
      totalCandidates: Number(data.totalCandidates) || 0,
    };
  }, [normalizeLuckyReferences, params.luckyFavoriteCount, readLuckyError]);

  const createLuckyGeneration = useCallback(async (keywords = '') => {
    if (isCreatingLuckyPrompt || isLoadingLuckyReferences) return;
    if (!params.llmProviderId) {
      toast.error(t.luckyNeedsProvider);
      return;
    }
    setView('chat');
    setIsLoadingLuckyReferences(true);
    try {
      setLuckyReferencePreview({
        ...await requestLuckyReferences(keywords),
        guidance: '',
        activeTagSlug: '',
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.luckyPromptFailed);
    } finally {
      setIsLoadingLuckyReferences(false);
    }
  }, [isCreatingLuckyPrompt, isLoadingLuckyReferences, params.llmProviderId, requestLuckyReferences, t.luckyNeedsProvider, t.luckyPromptFailed]);

  const confirmLuckyGeneration = useCallback(async () => {
    if (!luckyReferencePreview || isCreatingLuckyPrompt) return;
    setIsCreatingLuckyPrompt(true);
    const preview = luckyReferencePreview;
    setLuckyReferencePreview(null);
    try {
      let targetSessionId: string | undefined = currentSessionId ?? undefined;
      if (!targetSessionId) targetSessionId = await createNewSession();

      const response = await fetch(`${API_BASE}/api/llm/lucky-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: params.llmProviderId,
          temperature: params.luckyTemperature,
          favoriteCount: params.luckyFavoriteCount,
          keywords: preview.keywords,
          referenceIds: preview.references.map((reference) => reference.messageId),
          guidance: preview.guidance,
        }),
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(readLuckyError(data));
      if (!data.prompt?.trim()) throw new Error(t.luckyPromptFailed);

      // The lucky prompt is complete. Remove its dedicated loading card before
      // handleSend adds the pending generation card, so both states never overlap.
      setIsCreatingLuckyPrompt(false);
      await handleSend(data.prompt.trim(), false, targetSessionId, true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.luckyPromptFailed);
    } finally {
      setIsCreatingLuckyPrompt(false);
    }
  }, [createNewSession, currentSessionId, handleSend, isCreatingLuckyPrompt, luckyReferencePreview, params.llmProviderId, params.luckyFavoriteCount, params.luckyTemperature, readLuckyError, t.luckyPromptFailed]);

  const rerollAllLuckyReferences = useCallback(async () => {
    if (!luckyReferencePreview || luckyRerollingId !== null) return;
    setLuckyRerollingId('all');
    try {
      setLuckyReferencePreview({
        ...await requestLuckyReferences(luckyReferencePreview.keywords, {
          excludeIds: luckyReferencePreview.references.map((reference) => reference.messageId),
          requiredTag: luckyReferencePreview.activeTagSlug || undefined,
        }),
        guidance: luckyReferencePreview.guidance,
        activeTagSlug: luckyReferencePreview.activeTagSlug,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.luckyPromptFailed);
    } finally {
      setLuckyRerollingId(null);
    }
  }, [luckyReferencePreview, luckyRerollingId, requestLuckyReferences, t.luckyPromptFailed]);

  const rerollOneLuckyReference = useCallback(async (messageId: string) => {
    if (!luckyReferencePreview || luckyRerollingId !== null) return;
    setLuckyRerollingId(messageId);
    try {
      const replacement = await requestLuckyReferences(luckyReferencePreview.keywords, {
        count: 1,
        excludeIds: luckyReferencePreview.references.map((reference) => reference.messageId),
        anchorIds: luckyReferencePreview.references.filter((reference) => reference.messageId !== messageId).map((reference) => reference.messageId),
        requiredTag: luckyReferencePreview.activeTagSlug || undefined,
      });
      if (!replacement.references[0]) throw new Error(t.luckyNoCoherentReferences);
      const references = luckyReferencePreview.references.map((reference) => (
        reference.messageId === messageId ? replacement.references[0] : reference
      ));
      setLuckyReferencePreview({
        ...luckyReferencePreview,
        references: normalizeLuckyReferences(references),
        totalCandidates: replacement.totalCandidates,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.luckyPromptFailed);
    } finally {
      setLuckyRerollingId(null);
    }
  }, [luckyReferencePreview, luckyRerollingId, normalizeLuckyReferences, requestLuckyReferences, t.luckyNoCoherentReferences, t.luckyPromptFailed]);

  const filterLuckyReferencesByTag = useCallback(async (tagSlug: string) => {
    if (!luckyReferencePreview || luckyRerollingId !== null) return;
    const preserved = luckyReferencePreview.references.filter((reference) => (
      reference.tags.some((tag) => tag.slug === tagSlug)
    ));
    const replacementCount = luckyReferencePreview.references.length - preserved.length;
    if (replacementCount === 0) {
      setLuckyReferencePreview({ ...luckyReferencePreview, activeTagSlug: tagSlug });
      return;
    }

    setLuckyRerollingId(`tag:${tagSlug}`);
    try {
      const replacements = await requestLuckyReferences(luckyReferencePreview.keywords, {
        count: replacementCount,
        excludeIds: luckyReferencePreview.references.map((reference) => reference.messageId),
        anchorIds: preserved.map((reference) => reference.messageId),
        requiredTag: tagSlug,
      });
      if (replacements.references.length < replacementCount) {
        throw new Error(t.luckyTagNotEnoughReferences);
      }
      let replacementIndex = 0;
      const references = luckyReferencePreview.references.map((reference) => {
        if (reference.tags.some((tag) => tag.slug === tagSlug)) return reference;
        return replacements.references[replacementIndex++];
      });
      setLuckyReferencePreview({
        ...luckyReferencePreview,
        references: normalizeLuckyReferences(references),
        totalCandidates: replacements.totalCandidates,
        activeTagSlug: tagSlug,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.luckyPromptFailed);
    } finally {
      setLuckyRerollingId(null);
    }
  }, [luckyReferencePreview, luckyRerollingId, normalizeLuckyReferences, requestLuckyReferences, t.luckyPromptFailed, t.luckyTagNotEnoughReferences]);

  const onInputChange = useCallback((val: string) => setInput(val), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showLightboxModify) {
          if (!isModifyingImage) setShowLightboxModify(false);
        } else if (showLightboxPrompt) {
          setShowLightboxPrompt(false);
        } else {
          closeLightbox();
        }
      }
      if (activeLightbox && !showLightboxModify && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        void navigateLightbox(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeLightbox, closeLightbox, isModifyingImage, navigateLightbox, showLightboxModify, showLightboxPrompt]);

  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const startNewChat = useCallback(() => {
    setView('chat');
    setActiveInfoId(null);
    setShowSessionMenu(false);
    return createNewSession();
  }, [createNewSession, setActiveInfoId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (sessionMenuRef.current && !sessionMenuRef.current.contains(event.target as Node)) {
        setShowSessionMenu(false);
      }
    };

    if (showSessionMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showSessionMenu]);

  useEffect(() => {
    const feedbackTimeouts = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
    let lastFeedbackTime = 0;

    const handleVisualFeedback = (e: PointerEvent) => {
      // Very short throttle for true rapid fire
      const status = Date.now();
      if (status - lastFeedbackTime < 50) return;
      lastFeedbackTime = status;

      // Select ANY interactive element that might need feedback
      const target = (e.target as HTMLElement).closest('button, .header-ai-toggle, .gallery-action-btn, .action-btn-icon, .dropdown-item, .image-fav-btn, .lightbox-btn, .action-pill-btn, .scroll-bottom-btn, .picker-item, .control-pill') as HTMLElement;
      
      if (target) {
        // 1. Clear existing timer
        const existingTimeout = feedbackTimeouts.get(target);
        if (existingTimeout) clearTimeout(existingTimeout);
        
        // 2. FORCE RESTART: Remove, reflow, then add
        target.classList.remove('click-feedback');
        void target.offsetWidth; // Trigger reflow
        target.classList.add('click-feedback');
        
        // 3. Set removal timer
        const timeout = setTimeout(() => {
          target.classList.remove('click-feedback');
          feedbackTimeouts.delete(target);
        }, 400); // Matches animation duration
        
        feedbackTimeouts.set(target, timeout);
      }
    };

    window.addEventListener('pointerdown', handleVisualFeedback, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleVisualFeedback, { capture: true });
    };
  }, []);

  const onScrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (scrollRequestTimeoutRef.current !== null) {
      window.clearTimeout(scrollRequestTimeoutRef.current);
      scrollRequestTimeoutRef.current = null;
    }
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      scrollAnimationFrameRef.current = null;
    }
    
    isProgrammaticScrollRef.current = true;
    setShowScrollBottom(false);
    isAnchoringRef.current = false;
    pendingAnchorRef.current = null;

    const startScroll = container.scrollTop;
    const initialTarget = Math.max(0, container.scrollHeight - container.clientHeight);
    const distance = Math.max(0, initialTarget - startScroll);
    const duration = Math.min(750, Math.max(350, 300 + distance * 0.18));
    const startTime = performance.now();

    const animateToBottom = (currentTime: number) => {
      if (!container.isConnected) {
        isProgrammaticScrollRef.current = false;
        scrollAnimationFrameRef.current = null;
        return;
      }

      const progress = Math.min((currentTime - startTime) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const currentTarget = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = startScroll + (currentTarget - startScroll) * easedProgress;

      if (progress < 1) {
        scrollAnimationFrameRef.current = window.requestAnimationFrame(animateToBottom);
        return;
      }

      container.scrollTop = currentTarget;
      isProgrammaticScrollRef.current = false;
      scrollAnimationFrameRef.current = null;
    };

    scrollAnimationFrameRef.current = window.requestAnimationFrame(animateToBottom);
  }, []);

  const focusActiveGeneration = useCallback(async () => {
    setActiveLightbox(null);
    try {
      const response = await fetch(`${API_BASE}/api/generate/active`, { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed to locate active generation: ${response.status}`);
      const generations = await response.json() as Array<{
        messageId: string;
        sessionId: string;
        status: 'processing' | 'pending';
      }>;
      const target = generations[0];
      if (!target) return;

      const targetIsLoaded = currentSessionId === target.sessionId
        && messages.some(message => message.id === target.messageId);
      if (targetIsLoaded) {
        setView('chat');
        window.setTimeout(() => smoothScrollTo(`msg-${target.messageId}`), 60);
      } else {
        goToImage(target.sessionId, target.messageId);
      }
    } catch (error) {
      console.error('Error locating active generation:', error);
      const fallback = messages.find(message => (
        message.role === 'bot'
        && (message.status === 'processing' || message.status === 'pending')
      ));
      if (fallback) {
        setView('chat');
        window.setTimeout(() => smoothScrollTo(`msg-${fallback.id}`), 60);
      }
    }
  }, [currentSessionId, goToImage, messages, smoothScrollTo]);

  if (isAuthenticated === null) return (
    <div className="app-loader">
      <div className="bounced-loader"><div className="bounce1"></div><div className="bounce2"></div><div className="bounce3"></div></div>
      <div>Chargement...</div>
    </div>
  );

  if (!isAuthenticated) return (
    <div className={`login-screen ${theme}`}>
      <div className="theme-toggle-corner"><button className="theme-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀️' : '🌙'}</button></div>
      <form className="login-form" onSubmit={(e) => { e.preventDefault(); login(loginUsername, loginPassword).then(r => !r.success && alert(r.error)); }}>
        <div className="login-header">
          <img className="login-logo" src={comfyForgeLogo} alt={`${t.title} — Connectez-vous pour commencer`} />
        </div>
        <div className="input-group"><label>{t.username}</label><input type="text" autoFocus value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} className={loginError ? 'error' : ''} /></div>
        <div className="input-group"><label>{t.password}</label><input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className={loginError ? 'error' : ''} />{loginError && <p className="error-msg">{t.incorrectLogin}</p>}</div>
        <button type="submit" disabled={isLoginLoading}>{isLoginLoading ? '...' : t.login}</button>
        <div style={{ marginTop: '1.5rem', textAlign: 'center', opacity: 0.3, fontSize: '0.7rem', letterSpacing: '0.05em' }}>
          v.{APP_CONFIG.VERSION}
        </div>
      </form>
    </div>
  );

  if (!isSettingsResolved) return (
    <div className="app-loader">
      <div className="bounced-loader"><div className="bounce1"></div><div className="bounce2"></div><div className="bounce3"></div></div>
      <div>Chargement...</div>
    </div>
  );

  const currentLightboxItem = activeLightbox ? (
    activeLightbox.source === 'chat' 
      ? messages.find(m => m.id === activeLightbox.messageId)
      : galleryItems.find(m => m.messageId === activeLightbox.messageId)
  ) : null;

  const isAlreadyLoaded = activeLightbox ? loadedHdImages.has(activeLightbox.messageId) : false;
  const currentLightboxPrompt = currentLightboxItem
    ? currentLightboxItem.generationPrompt || currentLightboxItem.prompt || currentLightboxItem.text || ''
    : '';
  const currentLightboxTags = currentLightboxItem?.tags || [];

  const regenerateLightboxImage = async () => {
    if (!activeLightbox || !currentLightboxItem) return;
    const prompt = currentLightboxItem.generationPrompt || currentLightboxItem.prompt || currentLightboxItem.text || '';
    if (!prompt.trim()) return;
    const { messageId, sessionId } = activeLightbox;

    setShowLightboxMenu(false);
    recordRegeneration(messageId);
    toast.success(t.regenerationStarted);
    try {
      await handleSend(prompt, true, sessionId, false, true);
    } catch (error) {
      console.error('Background regeneration failed:', error);
      toast.error(error instanceof Error ? error.message : t.retryFailed);
    }
  };

  const modifyLightboxImage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeLightbox || !currentLightboxItem || !modifyDirection.trim() || isModifyingImage) return;
    const prompt = currentLightboxPrompt.trim();
    if (!prompt) return;

    const { messageId, sessionId } = activeLightbox;
    setIsModifyingImage(true);
    try {
      const response = await fetch(`${API_BASE}/api/llm/rewrite-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          prompt,
          direction: modifyDirection.trim(),
          providerId: params.llmProviderId,
        }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.rewrittenPrompt !== 'string' || !data.rewrittenPrompt.trim()) {
        throw new Error(data.error || t.modificationFailed);
      }

      const seed = currentLightboxItem.seed;
      const seedOverrides: Partial<GenParameters> = keepModifySeed && seed !== undefined && seed !== null
        ? { seedMode: 'fixed', forcedSeed: String(seed) }
        : { seedMode: 'random', forcedSeed: '' };
      recordRegeneration(messageId);
      await handleSend(data.rewrittenPrompt.trim(), true, sessionId, true, true, false, seedOverrides);
      setShowLightboxModify(false);
      setModifyDirection('');
      toast.success(t.modificationStarted);
    } catch (error) {
      console.error('Image modification failed:', error);
      toast.error(error instanceof Error ? error.message : t.modificationFailed);
    } finally {
      setIsModifyingImage(false);
    }
  };

  return (
    <ErrorBoundary name="ComfyForge App">
      <div className={`app-layout ${theme} ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <Toaster position="top-right" containerClassName="app-toaster" />
        {activeLightbox && (
        <div className={`lightbox ${zoomScale > 1 ? 'zoomed' : ''}`} onClick={handleLightboxBackdropClick} onTouchStart={handleLightboxTouchStart} onTouchMove={handleLightboxTouchMove} onTouchEnd={handleLightboxTouchEnd} onTouchCancel={handleLightboxTouchEnd}>
          <div className="lightbox-content" key={activeLightbox.messageId} onClick={handleLightboxImageClick}>
            {activeLightbox.thumbnailUrl && !isAlreadyLoaded && (
              <img src={getFullImageUrl(activeLightbox.thumbnailUrl)} alt="Loading..." className="lightbox-thumb" style={{ filter: 'blur(10px)', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: hdLoaded === activeLightbox.messageId ? 0 : 1, transition: 'opacity 0.3s ease-out' }} />
            )}
            <img ref={lightboxImageRef} src={getFullImageUrl(activeLightbox.url)} alt="Fullscreen" className="lightbox-hd" style={{ position: 'relative', zIndex: 2, opacity: (hdLoaded === activeLightbox.messageId || isAlreadyLoaded) ? 1 : 0, transition: isAlreadyLoaded ? 'none' : 'opacity 0.4s ease-in', transform: `translate(${zoomOffset.x}px, ${zoomOffset.y}px) scale(${zoomScale})` }} onLoad={() => { setHdLoaded(activeLightbox.messageId); setLoadedHdImages(prev => new Set(prev).add(activeLightbox.messageId)); }} />
            {favoritedId === activeLightbox.messageId && <div className="image-overlay-heart" style={{ fontSize: '8rem' }}>❤️</div>}
          </div>
          {showLightboxPrompt && (
            <section
              className="lightbox-prompt-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lightbox-prompt-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="lightbox-prompt-header">
                <h2 id="lightbox-prompt-title">{t.finalPrompt}</h2>
                <button
                  type="button"
                  className="lightbox-prompt-close"
                  onClick={() => setShowLightboxPrompt(false)}
                  title={t.close}
                  aria-label={t.close}
                >
                  <XIcon size={18} />
                </button>
              </div>
              <p className="lightbox-prompt-text">{currentLightboxPrompt}</p>
              {currentLightboxTags.length > 0 && (
                <div className="lightbox-prompt-tags">
                  <span className="lightbox-prompt-tags-title">{t.promptTags}</span>
                  <div className="lightbox-prompt-tags-list" role="list">
                    {currentLightboxTags.map((tag) => (
                      <span key={tag.slug} role="listitem">
                        {lang === 'fr' ? tag.labelFr : tag.labelEn}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
          {showLightboxModify && (
            <form
              className="lightbox-modify-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lightbox-modify-title"
              onClick={(event) => event.stopPropagation()}
              onSubmit={modifyLightboxImage}
            >
              <div className="lightbox-prompt-header">
                <h2 id="lightbox-modify-title">{t.modifyImageTitle}</h2>
                <button
                  type="button"
                  className="lightbox-prompt-close"
                  onClick={() => setShowLightboxModify(false)}
                  disabled={isModifyingImage}
                  title={t.close}
                  aria-label={t.close}
                >
                  <XIcon size={18} />
                </button>
              </div>
              <p className="lightbox-modify-help">{t.modifyImageHelp}</p>
              <input
                type="text"
                className="lightbox-modify-input"
                value={modifyDirection}
                onChange={(event) => setModifyDirection(event.target.value)}
                placeholder={t.modifyImagePlaceholder}
                maxLength={1000}
                autoFocus
                disabled={isModifyingImage}
              />
              <div className={`lightbox-seed-toggle ${currentLightboxItem?.seed === undefined || currentLightboxItem?.seed === null ? 'disabled' : ''}`}>
                <span>
                  <strong>{t.keepSeed}</strong>
                  <small>{t.keepSeedHelp}</small>
                </span>
                <button
                  type="button"
                  className={`modify-toggle ${keepModifySeed ? 'on' : ''}`}
                  role="switch"
                  aria-checked={keepModifySeed}
                  onClick={() => setKeepModifySeed(value => !value)}
                  disabled={isModifyingImage || currentLightboxItem?.seed === undefined || currentLightboxItem?.seed === null}
                >
                  <span />
                </button>
              </div>
              <div className="lightbox-modify-actions">
                <button type="button" className="modify-cancel" onClick={() => setShowLightboxModify(false)} disabled={isModifyingImage}>{t.cancel}</button>
                <button type="submit" className="modify-submit" disabled={!modifyDirection.trim() || isModifyingImage}>
                  {isModifyingImage ? t.rewritingPrompt : t.generateVariation}
                </button>
              </div>
            </form>
          )}
          <div className="lightbox-actions" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-toolbar">
              <button className="lightbox-btn" onClick={() => { goToImage(activeLightbox.sessionId, activeLightbox.messageId); setActiveLightbox(null); }} title={t.viewInChat} aria-label={t.viewInChat}>💬</button>
              <button className={`lightbox-btn favorite ${currentLightboxItem?.isFavorite ? 'active' : ''}`} onClick={() => toggleFavorite(activeLightbox.sessionId, activeLightbox.messageId, currentLightboxItem?.isFavorite)} title={t.favorites} aria-label={t.favorites}>{currentLightboxItem?.isFavorite ? '❤️' : '🤍'}</button>
              <button
                className={`lightbox-btn prompt-like ${currentLightboxItem?.isPromptFavorite ? 'active' : ''}`}
                onClick={() => togglePromptFavorite(activeLightbox.sessionId, activeLightbox.messageId, currentLightboxItem?.isPromptFavorite)}
                title={t.likePrompt}
                aria-label={t.likePrompt}
                aria-pressed={currentLightboxItem?.isPromptFavorite === 1}
              >
                <ThumbUpIcon />
              </button>
              <div className="lightbox-menu-wrap">
                {showLightboxMenu && (
                  <div className="lightbox-menu" role="menu" aria-label={t.actions}>
                    <button
                      type="button"
                      className="lightbox-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setShowLightboxMenu(false);
                        void downloadImage(getFullImageUrl(activeLightbox.url), `img-${activeLightbox.messageId}.png`);
                      }}
                    >
                      <span className="lightbox-menu-icon" aria-hidden="true">↓</span>
                      <span>{t.download}</span>
                    </button>
                    <button
                      type="button"
                      className="lightbox-menu-item"
                      role="menuitem"
                      disabled={!currentLightboxPrompt.trim()}
                      onClick={() => {
                        if (!currentLightboxPrompt.trim()) return;
                        setShowLightboxMenu(false);
                        setShowLightboxPrompt(true);
                      }}
                    >
                      <span className="lightbox-menu-icon" aria-hidden="true"><InfoIcon size={18} /></span>
                      <span>{t.viewPrompt}</span>
                    </button>
                    <button
                      type="button"
                      className="lightbox-menu-item"
                      role="menuitem"
                      onClick={() => {
                        if (!currentLightboxItem) return;
                        handleEdit(currentLightboxItem.generationPrompt || currentLightboxItem.prompt || currentLightboxItem.text || '');
                        setShowLightboxMenu(false);
                        setActiveLightbox(null);
                      }}
                    >
                      <span className="lightbox-menu-icon" aria-hidden="true"><ComposeIcon size={18} /></span>
                      <span>{t.reusePrompt}</span>
                    </button>
                    <button
                      type="button"
                      className="lightbox-menu-item"
                      role="menuitem"
                      disabled={!currentLightboxPrompt.trim()}
                      onClick={() => {
                        setModifyDirection('');
                        setKeepModifySeed(currentLightboxItem?.seed !== undefined && currentLightboxItem?.seed !== null);
                        setShowLightboxMenu(false);
                        setShowLightboxPrompt(false);
                        setShowLightboxModify(true);
                      }}
                    >
                      <span className="lightbox-menu-icon" aria-hidden="true"><ComposeIcon size={18} /></span>
                      <span>{t.modifyImage}</span>
                    </button>
                    <button
                      type="button"
                      className="lightbox-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setShowLightboxMenu(false);
                        void regenerateLightboxImage();
                      }}
                    >
                      <span className="lightbox-menu-icon" aria-hidden="true"><RefreshIcon size={18} /></span>
                      <span>{t.regenerate}</span>
                      {(regenerationCounts[activeLightbox.messageId] || 0) >= 2 && (
                        <span className="lightbox-menu-count" aria-hidden="true">
                          ×{regenerationCounts[activeLightbox.messageId]}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="lightbox-menu-item"
                      role="menuitem"
                      disabled={!currentLightboxItem?.seed}
                      onClick={() => {
                        const seed = currentLightboxItem?.seed;
                        if (!seed) return;
                        setParams(prev => ({ ...prev, seedMode: 'fixed', forcedSeed: seed.toString() }));
                        setShowLightboxMenu(false);
                        setView('chat');
                        setActiveLightbox(null);
                        setOpenOptionsRequest(request => request + 1);
                        toast.success(t.reuseSeed);
                      }}
                    >
                      <span className="lightbox-menu-icon" aria-hidden="true">🎲</span>
                      <span>{t.reuseSeed}</span>
                    </button>
                    <button
                      type="button"
                      className="lightbox-menu-item"
                      role="menuitem"
                      onClick={() => openComparison(activeLightbox.messageId)}
                    >
                      <span className="lightbox-menu-icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="7" height="16" rx="2" />
                          <rect x="14" y="4" width="7" height="16" rx="2" />
                          <path d="M12 7v10" />
                          <path d="m10.5 9 1.5-2 1.5 2M10.5 15l1.5 2 1.5-2" />
                        </svg>
                      </span>
                      <span>{currentLightboxItem?.comparisonMessageId
                        ? (lang === 'fr' ? 'Voir la comparaison' : 'View comparison')
                        : (lang === 'fr' ? 'Comparer' : 'Compare')}</span>
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className={`lightbox-btn lightbox-more-btn ${showLightboxMenu ? 'active' : ''}`}
                  onClick={() => setShowLightboxMenu(open => !open)}
                  title={t.actions}
                  aria-label={t.actions}
                  aria-haspopup="menu"
                  aria-expanded={showLightboxMenu}
                >
                  <MoreVerticalIcon size={22} />
                </button>
              </div>
            </div>
            <div className="lightbox-top-actions">
              <button className="lightbox-btn close" onClick={closeLightbox} title={t.close} aria-label={t.close}>×</button>
            </div>
          </div>
        </div>
      )}

      {messageToDelete && (
        <div className="settings-modal-overlay" onClick={() => setMessageToDelete(null)}>
          <div className="settings-modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t.confirmDelete}</h3>
            <div className="confirm-buttons">
              <button className="confirm-btn delete" onClick={() => deleteMessage(messageToDelete)}>{t.confirm}</button>
              <button className="confirm-btn cancel" onClick={() => setMessageToDelete(null)}>{t.cancel}</button>
            </div>
          </div>
        </div>
      )}

      <SettingsModal
        showSettings={showSettings} setShowSettings={setShowSettings} activeTab={activeTab} setActiveTab={setActiveTab}
        params={params} setParams={setParams} lang={lang} t={t} currentUser={currentUser}
        comfyModels={comfyModels} diffusionModels={diffusionModels} isFetchingComfyModels={isFetchingComfyModels} fetchComfyModels={fetchComfyModels}
        comfyStatus={comfyStatus} testComfyConnection={testComfyConnection} isCheckingComfy={isCheckingComfy} comfyCheckStatus={comfyCheckStatus}
        availableWorkflows={availableWorkflows} fetchWorkflows={fetchWorkflows}
        adminUsers={adminUsers} newUser={newUser} setNewUser={setNewUser} handleAddUser={handleAddUser} isAdminLoading={isAdminLoading}
        deleteUser={internalDeleteUser} resetPasswordId={resetPasswordId} setResetPasswordId={setResetPasswordId} newPasswordValue={newPasswordValue}
        setNewPasswordValue={setNewPasswordValue} handleResetPassword={handleResetPassword}
        requestArchiveAll={() => setMassActionType('archiveAll')} requestDeleteAll={() => setMassActionType('deleteAll')}
        updateProfile={updateProfile} galleryItems={galleryItems} fetchGallery={fetchGallery}
      />

      {sessionToDelete && (
        <div className="settings-modal-overlay" onClick={() => setSessionToDelete(null)}>
          <div className="settings-modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t.confirmDelete}</h3>
            <div className="confirm-buttons">
              <button className="confirm-btn delete" onClick={confirmDeleteSession}>{t.confirm}</button>
              <button className="confirm-btn archive" onClick={() => toggleArchive(sessionToDelete, true)}>{t.archive}</button>
              <button className="confirm-btn cancel" onClick={() => setSessionToDelete(null)}>{t.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {massActionType && (
        <div className="settings-modal-overlay" onClick={() => setMassActionType(null)}>
          <div className={`settings-modal confirm-modal ${massActionType === 'deleteAll' ? 'delete-scope-modal' : ''}`} onClick={(e) => e.stopPropagation()}>
            {massActionType === 'archiveAll' ? (
              <>
                <h3>{t.archiveAll}</h3>
                <div className="confirm-buttons">
                  <button className="confirm-btn archive" onClick={archiveAllSessions}>{t.confirm}</button>
                  <button className="confirm-btn cancel" onClick={() => setMassActionType(null)}>{t.cancel}</button>
                </div>
              </>
            ) : (
              <>
                <h3>{t.deleteConversationsTitle}</h3>
                <p className="delete-scope-intro">{t.deleteConversationsHelp}</p>
                <div className="delete-scope-options">
                  <button type="button" onClick={() => void deleteSessions('active')}>
                    <strong>{t.deleteActiveOnly}</strong>
                    <small>{t.deleteActiveOnlyHelp}</small>
                  </button>
                  <button type="button" onClick={() => void deleteSessions('archived')}>
                    <strong>{t.deleteArchivesOnly}</strong>
                    <small>{t.deleteArchivesOnlyHelp}</small>
                  </button>
                  <button type="button" className="delete-everything" onClick={() => void deleteSessions('all')}>
                    <strong>{t.deleteActiveAndArchives}</strong>
                    <small>{t.deleteActiveAndArchivesHelp}</small>
                  </button>
                </div>
                <button type="button" className="delete-scope-cancel" onClick={() => setMassActionType(null)}>{t.cancel}</button>
              </>
            )}
          </div>
        </div>
      )}

      <Sidebar
        sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} backendError={backendError} t={t}
        createNewSession={startNewChat} view={view} setView={setView} openComparisonHome={openComparisonHome} fetchGallery={fetchGallery}
        sessions={sessions} onSessionViewed={(id) => { void markSessionAsViewed(id); }}
        currentSessionId={currentSessionId} setCurrentSessionId={setCurrentSessionId}
        setMessages={setMessages}
        renamingId={renamingId} setRenamingId={setRenamingId} renameValue={renameValue} setRenameValue={setRenameValue}
        renameSession={renameSession} toggleArchive={toggleArchive}
        setShowSettings={setShowSettings}
        handleLogout={handleLogout}
        currentUser={currentUser} lang={lang} setLang={setLang} theme={theme} setTheme={setTheme}
        keepAwake={keepAwake} setKeepAwake={setKeepAwake}
      />

      <main className="main-content">
        <header className="chat-header">
          <div className="header-left">
            <button className="header-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <div className={`hamburger-icon ${sidebarOpen ? 'open' : ''}`}><span></span><span></span></div>
            </button>
            {view !== 'statistics' && view !== 'comparison' && <div className={`header-ai-toggle ${params.llmEnabled ? 'active' : ''}`} onClick={() => setParams({ ...params, llmEnabled: !params.llmEnabled })} title={t.llmEnabled}>
              <span className="ai-text">AI</span>
              <div className={`mini-toggle ${params.llmEnabled ? 'on' : ''}`}><div className="mini-toggle-thumb"></div></div>
            </div>}
          </div>

          {view !== 'statistics' && view !== 'comparison' && <div className="header-right">
            {showQueueIndicator && (queueRemaining ?? 0) >= 2 && (
              <button
                type="button"
                className="queue-status-indicator"
                role="status"
                aria-live="polite"
                aria-label={`${queueRemaining} ${t.generationsInProgress}. ${t.viewActiveGenerations}`}
                title={t.viewActiveGenerations}
                onClick={focusActiveGeneration}
              >
                <span className="queue-status-dot" aria-hidden="true" />
                <strong>{queueRemaining}</strong>
                <span className="queue-status-label">{t.generationsInProgress}</span>
              </button>
            )}
            <div className="header-actions-pill">
              <button className="action-pill-btn" onClick={() => { void startNewChat(); }} title="Nouveau message">
                <ComposeIcon size={18} />
              </button>
              <div className="session-menu-container" ref={sessionMenuRef}>
                <button
                  className={`action-pill-btn ${showSessionMenu ? 'active' : ''}`}
                  onClick={() => setShowSessionMenu(!showSessionMenu)}
                  aria-label={t.options}
                  aria-expanded={showSessionMenu}
                >
                  <MoreVerticalIcon size={20} />
                </button>
                {showSessionMenu && currentSessionId && (
                  <div className="session-dropdown">
                    <button className="dropdown-item" onClick={() => { setRenamingId(currentSessionId); setRenameValue(sessions.find(s => s.id === currentSessionId)?.title || ''); setShowSessionMenu(false); setSidebarOpen(true); }}>
                      <span>✎</span> {t.rename}
                    </button>

                    <button className="dropdown-item delete" onClick={(e) => { deleteSession(e, currentSessionId); setShowSessionMenu(false); }}>
                      <span>🗑️</span> {t.delete}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>}
        </header>

        {view === 'statistics' ? <StatisticsDashboard lang={lang} /> : view === 'comparison' ? (
          <ComparisonView
            lang={lang}
            favoriteModels={params.favoriteModels || []}
            currentModel={params.comfyModel}
            currentModelType={params.comfyModelType}
            initialMessageId={comparisonMessageId}
            queueRemaining={queueRemaining}
            companionSettings={params.companionSettings}
            onModelActivated={activateComparedModel}
          />
        ) : <ChatInterface
          view={view} messages={messages} lang={lang} t={t} isGenerating={isGenerating} isEnhancing={isEnhancing}
          currentSessionId={currentSessionId} input={input} setInput={onInputChange} handleSend={onHandleSend}
          createLuckyGeneration={createLuckyGeneration} isCreatingLuckyPrompt={isCreatingLuckyPrompt} isLoadingLuckyReferences={isLoadingLuckyReferences}
          regenerationCounts={regenerationCounts} recordRegeneration={recordRegeneration}
          retryMessage={retryMessage} retryAllIncomplete={retryAllIncomplete} updatePendingPrompt={updatePendingPrompt}
          interruptGeneration={interruptGeneration} handleEdit={handleEdit} goToImage={goToImage} openComparison={openComparison} setActiveInfoId={setActiveInfoId} activeInfoId={activeInfoId}
          setMessageToDelete={setMessageToDelete} toggleFavorite={toggleFavorite} togglePromptFavorite={togglePromptFavorite} handleImageClick={handleImageClick} favoritedId={favoritedId}
          galleryItems={galleryItems} galleryTotal={galleryTotal} isFetchingGallery={isFetchingGallery} favoritesOnly={favoritesOnly} setFavoritesOnly={setFavoritesOnly}
          availablePromptTags={availablePromptTags} selectedPromptTags={selectedPromptTags} setSelectedPromptTags={setSelectedPromptTags}
          gallerySearch={gallerySearch} setGallerySearch={setGallerySearch} openPromptTag={openPromptTag}
          showArchivedInGallery={showArchivedInGallery} setShowArchivedInGallery={setShowArchivedInGallery}
          setHasMoreGallery={setHasMoreGallery} lastImageElementRef={lastImageElementRef} containerRef={containerRef} textareaRef={textareaRef}
          messagesEndRef={messagesEndRef} params={params} setParams={setParams} smoothScrollTo={smoothScrollTo} handleScroll={handleScroll} downloadImage={downloadImage}
          showScrollBottom={showScrollBottom} onScrollToBottom={onScrollToBottom}
          openOptionsRequest={openOptionsRequest}
        />}
      </main>
      {luckyReferencePreview && (
        <LuckyReferencesModal
          keywords={luckyReferencePreview.keywords}
          references={luckyReferencePreview.references}
          totalCandidates={luckyReferencePreview.totalCandidates}
          lang={lang}
          t={t}
          busy={isCreatingLuckyPrompt || luckyRerollingId !== null}
          rerollingId={luckyRerollingId}
          guidance={luckyReferencePreview.guidance}
          activeTagSlug={luckyReferencePreview.activeTagSlug}
          onGuidanceChange={(guidance) => setLuckyReferencePreview((current) => current ? { ...current, guidance } : current)}
          onTagSelect={(tagSlug) => { void filterLuckyReferencesByTag(tagSlug); }}
          onClose={() => setLuckyReferencePreview(null)}
          onRerollAll={() => { void rerollAllLuckyReferences(); }}
          onRerollOne={(messageId) => { void rerollOneLuckyReference(messageId); }}
          onCreate={() => { void confirmLuckyGeneration(); }}
        />
      )}
      </div>
    </ErrorBoundary>
  );
}

export default App;
