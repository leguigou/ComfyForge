import { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';
import { translations } from './i18n';
import type { 
  GalleryItem, 
  GenParameters, 
  Theme, 
  Language,
  User,
  Message,
  PromptTag
} from './types';
import { API_BASE, getFullImageUrl } from './services/api';
import { Sidebar } from './components/sidebar/Sidebar';
import { SettingsModal } from './components/settings/SettingsModal';
import { DEFAULT_RANDOM_PROMPT_LISTS, migrateRandomPromptLists, RANDOM_PROMPT_LISTS_VERSION } from './utils/randomPrompts';
import { DEFAULT_COMPANION_SETTINGS, normalizeCompanionSettings } from './utils/companions';
import { ChatInterface } from './components/chat/ChatInterface';
import { APP_CONFIG } from './config';
import { useAuth } from './hooks/useAuth';
import { useSessions } from './hooks/useSessions';
import { useGeneration } from './hooks/useGeneration';
import { useWebSocket } from './hooks/useWebSocket';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { ComposeIcon, MoreVerticalIcon, RefreshIcon, ThumbUpIcon } from './components/ui/Icons';
import toast, { Toaster } from 'react-hot-toast';
import NoSleep from 'nosleep.js';

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

  const [view, setView] = useState<'chat' | 'gallery' | 'archives'>(() => {
    return (localStorage.getItem('currentView') as 'chat' | 'gallery' | 'archives') || 'chat';
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
    deleteAllActiveSessions,
    deleteMessage,
    massActionType,
    setMassActionType
  } = useSessions(view, isAuthenticated);

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [queueRemaining, setQueueRemaining] = useState<number | null>(null);
  const [showQueueIndicator, setShowQueueIndicator] = useState(
    () => sessionStorage.getItem('comfyforge.queueIndicatorLatched') === 'true'
  );
  const [isCreatingLuckyPrompt, setIsCreatingLuckyPrompt] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'companions' | 'profile' | 'images' | 'random' | 'comfy' | 'llm' | 'archives' | 'update' | 'admin'>('images');
  
  const [input, setInput] = useState('');
  const [openOptionsRequest, setOpenOptionsRequest] = useState(0);
  
  const [params, setParams] = useState<GenParameters>(() => {
    return { 
      width: 896, 
      height: 1152, 
      steps: 8, 
      cfg: 1.1,
      comfyUrl: 'http://127.0.0.1:8188',
      comfyModel: 'dirtyRealism_DMDSAT.safetensors',
      comfyModelType: 'checkpoint',
      llmUrl: '',
      llmModel: 'llama3:latest',
      llmSystemMessage: "You are a professional stable diffusion prompt engineer. Transform the user's brief idea into a highly detailed, descriptive, and artistic prompt in ENGLISH. Also generate a negative prompt of things to avoid. Output your response as a JSON object with two keys: 'positive' and 'negative'. No other text.",
      negativePrompt: "low quality, bad anatomy, malformed, extra limbs, extra fingers, fused fingers, bad hands, poorly drawn hands, missing fingers, fused face, poorly drawn face, asymmetrical, cartoon, anime, 3d, render, watermark, text, logo, swept hair, portrait",
      llmEnabled: false,
      workflowFile: 'workflow_lcm.json',
      nodeMapping: { checkpoint: "1", positive: "3", negative: "4", ksampler: "10", latent: "6", save: "99" },
      seedMode: 'random',
      forcedSeed: '',
      favoriteModels: [],
      randomPromptLists: DEFAULT_RANDOM_PROMPT_LISTS,
      randomPromptListsVersion: RANDOM_PROMPT_LISTS_VERSION,
      companionSettings: DEFAULT_COMPANION_SETTINGS
    };
  });
  const lastSavedParamsRef = useRef<string>('');

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
  const { handleSend, retryMessage, retryAllIncomplete, interruptGeneration, isEnhancing } = useGeneration(currentSessionId, params, clientIdRef, setMessages, smoothScrollTo, fetchSessions);

  const isGenerating = isEnhancing || messages.some(m => m.role === 'bot' && (m.status === 'pending' || m.status === 'processing'));

  useEffect(() => {
    if (queueRemaining === null) return;
    if (queueRemaining > 0) {
      setShowQueueIndicator(true);
      sessionStorage.setItem('comfyforge.queueIndicatorLatched', 'true');
    } else if (queueRemaining === 0) {
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
  const touchStartDist = useRef<number | null>(null);
  const lastTouchPos = useRef<{ x: number, y: number } | null>(null);

  // Clear HD state and zoom when lightbox closes
  useEffect(() => {
    if (!activeLightbox) {
      if (hdLoaded !== null) setHdLoaded(null);
      setZoomScale(1);
      setZoomOffset({ x: 0, y: 0 });
    }
    setShowLightboxMenu(false);
  }, [activeLightbox, hdLoaded]);

  const handleLightboxTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Start pinching
      const dist = Math.hypot(
        e.touches[0].pageX - e.touches[1].clientX,
        e.touches[0].pageY - e.touches[1].clientY
      );
      touchStartDist.current = dist;
    } else if (e.touches.length === 1 && zoomScale > 1) {
      // Start panning (only if zoomed in)
      lastTouchPos.current = { x: e.touches[0].pageX, y: e.touches[0].pageY };
    } else {
      // Swipe logic fallback
      handleTouchStart(e);
    }
  };

  const handleLightboxTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDist.current !== null) {
      // Pinching
      const dist = Math.hypot(
        e.touches[0].pageX - e.touches[1].clientX,
        e.touches[0].pageY - e.touches[1].clientY
      );
      const scaleChange = dist / touchStartDist.current;
      const newScale = Math.min(Math.max(1, zoomScale * scaleChange), 4);
      setZoomScale(newScale);
      touchStartDist.current = dist;
    } else if (e.touches.length === 1 && lastTouchPos.current && zoomScale > 1) {
      // Panning
      const deltaX = e.touches[0].pageX - lastTouchPos.current.x;
      const deltaY = e.touches[0].pageY - lastTouchPos.current.y;
      setZoomOffset(prev => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
      lastTouchPos.current = { x: e.touches[0].pageX, y: e.touches[0].pageY };
    } else if (e.touches.length === 1 && zoomScale === 1) {
      // Swipe logic fallback
      handleTouchMove(e);
    }
  };

  const handleLightboxTouchEnd = () => {
    touchStartDist.current = null;
    lastTouchPos.current = null;
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
  const [hasMoreGallery, setHasMoreGallery] = useState(true);
  const hasMoreGalleryRef = useRef(true);
  const [isFetchingGallery, setIsFetchingGallery] = useState(false);
  const isFetchingGalleryRef = useRef(false);
  const [showArchivedInGallery, setShowArchivedInGallery] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [availablePromptTags, setAvailablePromptTags] = useState<PromptTag[]>([]);
  const [selectedPromptTags, setSelectedPromptTags] = useState<string[]>([]);
  const [gallerySearch, setGallerySearch] = useState('');
  const [debouncedGallerySearch, setDebouncedGallerySearch] = useState('');
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);
  const [favoritedId, setFavoritedId] = useState<string | null>(null);
  const clickTimeoutRef = useRef<number | null>(null);

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

  const handleLightboxImageClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setActiveLightbox(null);
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
  }, [activeLightbox, messages, galleryItems, toggleFavorite]);

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

  const handleScroll = useCallback((isUserScroll: boolean | React.UIEvent = false) => {
    if (isProgrammaticScrollRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    
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
  }, []);

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
    try {
      const res = await fetch(`${API_BASE}/api/settings`, { credentials: 'include' });
      const data = await res.json();
      if (data && data.width) {
        setParams(prev => {
          const storedParams = {
            ...prev,
            ...data,
            favoriteModels: data.favoriteModels || prev.favoriteModels,
            randomPromptLists: data.randomPromptLists || prev.randomPromptLists,
            companionSettings: normalizeCompanionSettings(data.companionSettings || prev.companionSettings)
          };
          lastSavedParamsRef.current = JSON.stringify(storedParams);
          return {
            ...storedParams,
            randomPromptLists: migrateRandomPromptLists(storedParams.randomPromptLists, data.randomPromptListsVersion),
            randomPromptListsVersion: RANDOM_PROMPT_LISTS_VERSION
          };
        });
      }
    } catch (err) { console.error('Error fetching settings:', err); }
    finally { setIsSettingsLoaded(true); }
  }, []);

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
      if (res.ok) {
        lastSavedParamsRef.current = paramsString;
        if (!silent) {
          toast.success(t.settingsSaved, { id: 'settings-save' });
        }
      }
    } catch (err) { console.error('Error saving settings:', err); }
  }, [isSettingsLoaded, t.settingsSaved]);

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

  const fetchGallery = useCallback(async (isInitial = false) => {
    if (!isInitial && (isFetchingGalleryRef.current || !hasMoreGalleryRef.current)) return;

    const requestId = isInitial ? ++galleryRequestRef.current : galleryRequestRef.current;
    
    isFetchingGalleryRef.current = true;
    setIsFetchingGallery(true);
    
    const currentOffset = isInitial ? 0 : galleryOffsetRef.current;
    try {
      const query = new URLSearchParams({
        limit: '25',
        offset: String(currentOffset),
        includeArchived: String(showArchivedInGallery),
        favoritesOnly: String(favoritesOnly),
      });
      selectedPromptTags.forEach(tag => query.append('tag', tag));
      if (debouncedGallerySearch) query.set('search', debouncedGallerySearch);
      const res = await fetch(`${API_BASE}/api/gallery?${query.toString()}`, { credentials: 'include' });
      if (!res.ok) {
        throw new Error(`Failed to fetch gallery: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();

      if (!Array.isArray(data)) {
        console.error('Gallery API did not return an array:', data);
        return;
      }

      if (requestId !== galleryRequestRef.current) return;

      if (isInitial) {
        setGalleryItems(data);
        galleryOffsetRef.current = data.length;
        hasMoreGalleryRef.current = data.length === 25;
        setHasMoreGallery(hasMoreGalleryRef.current);
      } else if (data.length > 0) {
        setGalleryItems(prev => {
          const existingIds = new Set(prev.map(item => item.messageId));
          const uniqueNewData = data.filter(item => !existingIds.has(item.messageId));
          return [...prev, ...uniqueNewData];
        });
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
      if (requestId === galleryRequestRef.current) {
        setIsFetchingGallery(false);
        isFetchingGalleryRef.current = false;
      }
    }
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
  const handleTouchEnd = useCallback(() => {
    if (!touchStart.current || !touchEnd.current) return;
    const distance = touchStart.current - touchEnd.current;
    if (activeLightbox && Math.abs(distance) > 50) {
      const isNext = distance > 0;
      const items = activeLightbox.source === 'chat' ? messages.filter(m => m.imageUrl) : galleryItems;
      const currentIndex = items.findIndex(m => {
        if (activeLightbox.source === 'chat') return (m as Message).id === activeLightbox.messageId;
        return (m as GalleryItem).messageId === activeLightbox.messageId;
      });
      if (currentIndex !== -1) {
        const nextIdx = isNext ? currentIndex + 1 : currentIndex - 1;
        if (nextIdx >= 0 && nextIdx < items.length) {
          const next = items[nextIdx];
          setHdLoaded(null);
          if (activeLightbox.source === 'chat') {
            const m = next as Message;
            setActiveLightbox({ url: m.imageUrl!, thumbnailUrl: m.thumbnailUrl, sessionId: currentSessionId || '', messageId: m.id, source: 'chat' });
          } else {
            const g = next as GalleryItem;
            setActiveLightbox({ url: g.imageUrl, thumbnailUrl: g.thumbnailUrl, sessionId: g.sessionId, messageId: g.messageId, source: 'gallery' });
          }
        }
      }
    }
    touchStart.current = touchEnd.current = null;
  }, [activeLightbox, messages, galleryItems, currentSessionId]);

  const downloadImage = useCallback(async (url: string, filename: string) => {
    const res = await fetch(url, { credentials: 'include' });
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  }, []);

  const onHandleSend = useCallback(async (override?: string, regen?: boolean, skipEnhancement?: boolean) => {
    const text = override !== undefined ? override : input;
    if (!text.trim()) return;

    let targetSessionId: string | undefined = currentSessionId ?? undefined;
    if (!targetSessionId) {
      targetSessionId = await createNewSession();
    }

    handleSend(text, regen, targetSessionId, skipEnhancement);
    if (override === undefined) setInput('');
  }, [handleSend, input, currentSessionId, createNewSession]);

  const createLuckyGeneration = useCallback(async () => {
    if (isCreatingLuckyPrompt) return;
    setIsCreatingLuckyPrompt(true);
    setView('chat');

    try {
      let targetSessionId: string | undefined = currentSessionId ?? undefined;
      if (!targetSessionId) targetSessionId = await createNewSession();

      const response = await fetch(`${API_BASE}/api/llm/lucky-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: params.llmProviderId }),
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.code === 'NO_LIKED_PROMPTS') throw new Error(t.luckyNeedsFavorites);
        if (data.code === 'NO_LLM_PROVIDER') throw new Error(t.luckyNeedsProvider);
        throw new Error(data.error || t.luckyPromptFailed);
      }
      if (!data.prompt?.trim()) throw new Error(t.luckyPromptFailed);

      await handleSend(data.prompt.trim(), false, targetSessionId, true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.luckyPromptFailed);
    } finally {
      setIsCreatingLuckyPrompt(false);
    }
  }, [createNewSession, currentSessionId, handleSend, isCreatingLuckyPrompt, params.llmProviderId, t.luckyNeedsFavorites, t.luckyNeedsProvider, t.luckyPromptFailed]);

  const onInputChange = useCallback((val: string) => setInput(val), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveLightbox(null);
      if (activeLightbox && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const items = activeLightbox.source === 'chat' ? messages.filter(m => m.imageUrl) : galleryItems;
        const currentIndex = items.findIndex(m => {
            if (activeLightbox.source === 'chat') return (m as Message).id === activeLightbox.messageId;
            return (m as GalleryItem).messageId === activeLightbox.messageId;
        });
        if (currentIndex !== -1) {
          const nextIdx = e.key === 'ArrowRight' ? currentIndex + 1 : currentIndex - 1;
          if (nextIdx >= 0 && nextIdx < items.length) {
            const next = items[nextIdx];
            if (activeLightbox.source === 'chat') {
              const m = next as Message;
              setActiveLightbox({ url: m.imageUrl!, thumbnailUrl: m.thumbnailUrl, sessionId: currentSessionId!, messageId: m.id, source: 'chat' });
            } else {
              const g = next as GalleryItem;
              setActiveLightbox({ url: g.imageUrl, thumbnailUrl: g.thumbnailUrl, sessionId: g.sessionId, messageId: g.messageId, source: 'gallery' });
            }
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeLightbox, messages, galleryItems, currentSessionId]);

  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const sessionMenuRef = useRef<HTMLDivElement>(null);

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
        <div className="login-header"><div className="login-icon">✨</div><h1>{t.title}</h1><p>Connectez-vous pour commencer</p></div>
        <div className="input-group"><label>{t.username}</label><input type="text" autoFocus value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} className={loginError ? 'error' : ''} /></div>
        <div className="input-group"><label>{t.password}</label><input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className={loginError ? 'error' : ''} />{loginError && <p className="error-msg">{t.incorrectLogin}</p>}</div>
        <button type="submit" disabled={isLoginLoading}>{isLoginLoading ? '...' : t.login}</button>
        <div style={{ marginTop: '1.5rem', textAlign: 'center', opacity: 0.3, fontSize: '0.7rem', letterSpacing: '0.05em' }}>
          v.{APP_CONFIG.VERSION}
        </div>
      </form>
    </div>
  );

  const currentLightboxItem = activeLightbox ? (
    activeLightbox.source === 'chat' 
      ? messages.find(m => m.id === activeLightbox.messageId)
      : galleryItems.find(m => m.messageId === activeLightbox.messageId)
  ) : null;

  const isAlreadyLoaded = activeLightbox ? loadedHdImages.has(activeLightbox.messageId) : false;

  const regenerateLightboxImage = async () => {
    if (!activeLightbox || !currentLightboxItem) return;
    const prompt = currentLightboxItem.generationPrompt || currentLightboxItem.prompt || currentLightboxItem.text || '';
    if (!prompt.trim()) return;
    const { messageId, sessionId } = activeLightbox;

    setShowLightboxMenu(false);
    setActiveLightbox(null);
    setView('chat');

    if (currentSessionId !== sessionId) {
      setMessages([]);
      setCurrentSessionId(sessionId);
      await fetchSessionDetails(sessionId);
    }

    recordRegeneration(messageId);
    await handleSend(prompt, true, sessionId);
    window.setTimeout(onScrollToBottom, 80);
  };

  return (
    <ErrorBoundary name="ComfyForge App">
      <div className={`app-layout ${theme} ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
        <Toaster position="top-right" />
        {activeLightbox && (
        <div className="lightbox" onClick={() => setActiveLightbox(null)} onTouchStart={handleLightboxTouchStart} onTouchMove={handleLightboxTouchMove} onTouchEnd={handleLightboxTouchEnd}>
          <div className="lightbox-content" key={activeLightbox.messageId} onClick={handleLightboxImageClick}>
            {activeLightbox.thumbnailUrl && !isAlreadyLoaded && (
              <img src={getFullImageUrl(activeLightbox.thumbnailUrl)} alt="Loading..." className="lightbox-thumb" style={{ filter: 'blur(10px)', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: hdLoaded === activeLightbox.messageId ? 0 : 1, transition: 'opacity 0.3s ease-out' }} />
            )}
            <img src={getFullImageUrl(activeLightbox.url)} alt="Fullscreen" className="lightbox-hd" style={{ position: 'relative', zIndex: 2, opacity: (hdLoaded === activeLightbox.messageId || isAlreadyLoaded) ? 1 : 0, transition: isAlreadyLoaded ? 'none' : 'opacity 0.4s ease-in', transform: `translate(${zoomOffset.x}px, ${zoomOffset.y}px) scale(${zoomScale})` }} onLoad={() => { setHdLoaded(activeLightbox.messageId); setLoadedHdImages(prev => new Set(prev).add(activeLightbox.messageId)); }} />
            {favoritedId === activeLightbox.messageId && <div className="image-overlay-heart" style={{ fontSize: '8rem' }}>❤️</div>}
          </div>
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
              <button className="lightbox-btn close" onClick={() => setActiveLightbox(null)} title={t.close} aria-label={t.close}>×</button>
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
        setNewPasswordValue={setNewPasswordValue} handleResetPassword={handleResetPassword} archiveAllSessions={archiveAllSessions} deleteAllActiveSessions={deleteAllActiveSessions}
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
          <div className="settings-modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{massActionType === 'archiveAll' ? t.archiveAll : t.confirmDeleteAll}</h3>
            <div className="confirm-buttons">
              <button className={`confirm-btn ${massActionType === 'deleteAll' ? 'delete' : 'archive'}`} onClick={massActionType === 'archiveAll' ? archiveAllSessions : deleteAllActiveSessions}>{t.confirm}</button>
              <button className="confirm-btn cancel" onClick={() => setMassActionType(null)}>{t.cancel}</button>
            </div>
          </div>
        </div>
      )}

      <Sidebar
        sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} backendError={backendError} t={t}
        createNewSession={createNewSession} view={view} setView={setView} fetchGallery={fetchGallery}
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
            <div className={`header-ai-toggle ${params.llmEnabled ? 'active' : ''}`} onClick={() => setParams({ ...params, llmEnabled: !params.llmEnabled })} title={t.llmEnabled}>
              <span className="ai-text">AI</span>
              <div className={`mini-toggle ${params.llmEnabled ? 'on' : ''}`}><div className="mini-toggle-thumb"></div></div>
            </div>
          </div>

          <div className="header-right">
            {showQueueIndicator && (queueRemaining ?? 0) > 0 && (
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
              <button className="action-pill-btn" onClick={() => createNewSession()} title="Nouveau message">
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
          </div>
        </header>

        <ChatInterface
          view={view} messages={messages} lang={lang} t={t} isGenerating={isGenerating} isEnhancing={isEnhancing}
          currentSessionId={currentSessionId} input={input} setInput={onInputChange} handleSend={onHandleSend}
          createLuckyGeneration={createLuckyGeneration} isCreatingLuckyPrompt={isCreatingLuckyPrompt}
          regenerationCounts={regenerationCounts} recordRegeneration={recordRegeneration}
          retryMessage={retryMessage} retryAllIncomplete={retryAllIncomplete}
          interruptGeneration={interruptGeneration} handleEdit={handleEdit} goToImage={goToImage} setActiveInfoId={setActiveInfoId} activeInfoId={activeInfoId}
          setMessageToDelete={setMessageToDelete} toggleFavorite={toggleFavorite} togglePromptFavorite={togglePromptFavorite} handleImageClick={handleImageClick} favoritedId={favoritedId}
          galleryItems={galleryItems} isFetchingGallery={isFetchingGallery} favoritesOnly={favoritesOnly} setFavoritesOnly={setFavoritesOnly}
          availablePromptTags={availablePromptTags} selectedPromptTags={selectedPromptTags} setSelectedPromptTags={setSelectedPromptTags}
          gallerySearch={gallerySearch} setGallerySearch={setGallerySearch} openPromptTag={openPromptTag}
          showArchivedInGallery={showArchivedInGallery} setShowArchivedInGallery={setShowArchivedInGallery}
          setHasMoreGallery={setHasMoreGallery} lastImageElementRef={lastImageElementRef} containerRef={containerRef} textareaRef={textareaRef}
          messagesEndRef={messagesEndRef} params={params} setParams={setParams} smoothScrollTo={smoothScrollTo} handleScroll={handleScroll} downloadImage={downloadImage}
          showScrollBottom={showScrollBottom} onScrollToBottom={onScrollToBottom}
          openOptionsRequest={openOptionsRequest}
        />
      </main>
      </div>
    </ErrorBoundary>
  );
}

export default App;
