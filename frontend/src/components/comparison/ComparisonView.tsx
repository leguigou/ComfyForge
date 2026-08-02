import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, Touch, TouchEvent, WheelEvent } from 'react';
import toast from 'react-hot-toast';
import type { CompanionSettings, FavoriteModel, Language } from '../../types';
import { API_BASE, formatDuration, getFullImageUrl } from '../../services/api';
import { getGenerationElapsedSeconds } from '../../utils/generationTimer';
import { SeedyCompanion } from '../chat/SeedyCompanion';
import './ComparisonView.css';

type ComparisonImage = {
  messageId: string;
  sessionId: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  prompt?: string;
  text?: string;
  generationPrompt?: string;
  model?: string;
  workflow?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  sampler?: string;
  scheduler?: string;
  duration?: number;
  generationStartedAt?: number | null;
  timestamp?: number;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  isFavorite?: number;
  isPromptFavorite?: number;
  comparisonMessageId?: string;
  comparisonSourceId?: string;
  comparisonPreferredMessageId?: string | null;
  comparisonPreferenceUpdatedAt?: number | null;
  comparisonVersionIndex?: number;
  comparisonVersionCount?: number;
};

type ComparisonPreference = {
  firstMessageId: string;
  secondMessageId: string;
  preferredMessageId: string | null;
  updatedAt: number;
};

const MIN_COMPARISON_COLUMNS = 1;
const MAX_COMPARISON_COLUMNS = 6;
const COMPARISON_PINCH_STEP = 1.16;
const COMPARISON_LONG_PRESS_MS = 1000;
const COMPARISON_LONG_PRESS_MOVE_TOLERANCE = 12;

const getTouchDistance = (touches: { item(index: number): Touch | null }) => {
  const first = touches.item(0);
  const second = touches.item(1);
  if (!first || !second) return 0;
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
};

const getVersionLetter = (index: number) => {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
};

const normalizeModelKey = (model?: string) => (model || '')
  .replace(/\\/g, '/')
  .split('/')
  .pop()
  ?.trim()
  .toLowerCase() || '';

const getPairKey = (firstMessageId: string, secondMessageId: string) => (
  firstMessageId < secondMessageId
    ? `${firstMessageId}:${secondMessageId}`
    : `${secondMessageId}:${firstMessageId}`
);

interface ComparisonViewProps {
  lang: Language;
  favoriteModels: FavoriteModel[];
  currentModel: string;
  currentModelType: 'checkpoint' | 'diffusion';
  initialMessageId: string | null;
  queueRemaining: number | null;
  companionSettings: CompanionSettings;
  onModelActivated: (favorite: FavoriteModel) => void;
}

export const ComparisonView = ({
  lang,
  favoriteModels,
  currentModel,
  currentModelType,
  initialMessageId,
  queueRemaining,
  companionSettings,
  onModelActivated
}: ComparisonViewProps) => {
  const [images, setImages] = useState<ComparisonImage[]>([]);
  const [source, setSource] = useState<ComparisonImage | null>(null);
  const [comparisons, setComparisons] = useState<ComparisonImage[]>([]);
  const [leftVersionId, setLeftVersionId] = useState('');
  const [rightVersionId, setRightVersionId] = useState('');
  const [preferences, setPreferences] = useState<ComparisonPreference[]>([]);
  const [savingPreference, setSavingPreference] = useState(false);
  const [selectedFavorite, setSelectedFavorite] = useState('');
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(() => new Set());
  const [batchActionMenuOpen, setBatchActionMenuOpen] = useState(false);
  const [batchModelPickerOpen, setBatchModelPickerOpen] = useState(false);
  const [selectedBatchFavorite, setSelectedBatchFavorite] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  const [serviceAvailable, setServiceAvailable] = useState(true);
  const [sourceLoadError, setSourceLoadError] = useState<string | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [inspectionEnabled, setInspectionEnabled] = useState(() => (
    localStorage.getItem('comparisonInspectionEnabled') === 'true'
  ));
  const [sliderPosition, setSliderPosition] = useState(50);
  const [sliderZoom, setSliderZoom] = useState(1);
  const [sliderPan, setSliderPan] = useState({ x: 0, y: 0 });
  const [loadedSliderImageIds, setLoadedSliderImageIds] = useState<Set<string>>(() => new Set());
  const [comparisonColumns, setComparisonColumns] = useState(() => {
    const saved = Number.parseInt(localStorage.getItem('comparisonColumns') || '', 10);
    if (saved >= MIN_COMPARISON_COLUMNS && saved <= MAX_COMPARISON_COLUMNS) return saved;
    return window.innerWidth <= 768 ? 3 : 6;
  });
  const [isPinchingGrid, setIsPinchingGrid] = useState(false);
  const [expandedMetadata, setExpandedMetadata] = useState<Set<string>>(() => new Set());
  const gridPinchRef = useRef({ startDistance: 0, startColumns: comparisonColumns, changed: false });
  const comparisonPageRef = useRef<HTMLElement | null>(null);
  const suppressGridClickRef = useRef(false);
  const suppressGridClickTimerRef = useRef<number | null>(null);
  const selectionModeRef = useRef(false);
  const longPressRef = useRef<{
    timer: number;
    messageId: string;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const pinchRef = useRef<{
    distance: number;
    zoom: number;
    pan: { x: number; y: number };
    midpoint: { x: number; y: number };
  } | null>(null);
  const fr = lang === 'fr';
  const sourceMessageId = source?.messageId;

  useLayoutEffect(() => {
    if (!sourceMessageId) return;
    comparisonPageRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [sourceMessageId]);

  useEffect(() => {
    localStorage.setItem('comparisonColumns', String(comparisonColumns));
  }, [comparisonColumns]);

  useEffect(() => {
    localStorage.setItem('comparisonInspectionEnabled', String(inspectionEnabled));
  }, [inspectionEnabled]);

  useEffect(() => () => {
    if (suppressGridClickTimerRef.current !== null) window.clearTimeout(suppressGridClickTimerRef.current);
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timer);
  }, []);

  useEffect(() => {
    setSelectedImageIds(current => {
      const visibleIds = new Set(images.map(item => item.messageId));
      const next = new Set([...current].filter(id => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [images]);

  const favoriteOptions = useMemo(() => favoriteModels.filter(item => item.workflowFile), [favoriteModels]);
  const currentFavoriteIndex = useMemo(() => favoriteOptions.findIndex(item => (
    item.model === currentModel && (item.modelType || 'checkpoint') === currentModelType
  )), [currentModel, currentModelType, favoriteOptions]);
  const versions = useMemo(() => source ? [source, ...comparisons] : [], [comparisons, source]);
  const leftVersion = versions.find(item => item.messageId === leftVersionId) || source;
  const rightVersion = versions.find(item => item.messageId === rightVersionId) || comparisons.at(-1) || source;
  const usedModels = useMemo(() => new Set(versions
    .filter(item => item === source || item.status !== 'failed')
    .map(item => normalizeModelKey(item.model))
    .filter(Boolean)), [source, versions]);

  const loadImages = useCallback(async () => {
    const response = await fetch(`${API_BASE}/api/comparisons`, { credentials: 'include' });
    if (!response.ok) throw new Error(fr ? 'Impossible de charger les images' : 'Unable to load images');
    setImages(await response.json());
  }, [fr]);

  const loadPair = useCallback(async (messageId: string, preserveSelection = false) => {
    const response = await fetch(`${API_BASE}/api/comparisons/${encodeURIComponent(messageId)}`, { credentials: 'include' });
    if (!response.ok) throw new Error(fr ? 'Comparaison introuvable' : 'Comparison not found');
    const data = await response.json();
    let nextComparisons: ComparisonImage[] = Array.isArray(data.comparisons)
      ? data.comparisons
      : data.comparison ? [data.comparison] : [];
    let nextPreferences: ComparisonPreference[] = Array.isArray(data.preferences) ? data.preferences : [];
    if (
      nextComparisons.length === 0
      && data.source?.comparisonMessageId
      && data.source.comparisonMessageId !== data.source.messageId
    ) {
      const linkedResponse = await fetch(
        `${API_BASE}/api/comparisons/${encodeURIComponent(data.source.comparisonMessageId)}`,
        { credentials: 'include' }
      );
      if (linkedResponse.ok) {
        const linkedData = await linkedResponse.json();
        nextComparisons = Array.isArray(linkedData.comparisons)
          ? linkedData.comparisons
          : linkedData.comparison ? [linkedData.comparison] : [];
        if (Array.isArray(linkedData.preferences)) nextPreferences = linkedData.preferences;
      }
    }
    const versionIds = new Set([data.source.messageId, ...nextComparisons.map(item => item.messageId)]);
    const requestedTarget = data.selectedMessageId !== data.source.messageId && versionIds.has(data.selectedMessageId)
      ? data.selectedMessageId
      : nextComparisons.at(-1)?.messageId || data.source.messageId;
    setSource(data.source);
    setComparisons(nextComparisons);
    setPreferences(nextPreferences);
    if (preserveSelection) {
      setLeftVersionId(current => versionIds.has(current) ? current : data.source.messageId);
      setRightVersionId(current => versionIds.has(current) ? current : requestedTarget);
    } else {
      setLeftVersionId(data.source.messageId);
      setRightVersionId(requestedTarget);
    }
    return { ...data, comparisons: nextComparisons };
  }, [fr]);

  const loadAvailability = useCallback(async () => {
    const response = await fetch(`${API_BASE}/api/comparisons/status/availability`, { credentials: 'include' });
    if (!response.ok) return;
    const data = await response.json();
    setServiceAvailable(data.available === true);
  }, []);

  useEffect(() => {
    setLoading(true);
    setSourceLoadError(null);
    // Loading the selected source must never depend on the comparison-history
    // request: a history failure previously sent users back to the home grid.
    const historyRequest = loadImages().catch(error => {
      console.error('Unable to load comparison history:', error);
    });
    const sourceRequest = initialMessageId
      ? loadPair(initialMessageId).catch(error => {
          setSourceLoadError(error instanceof Error ? error.message : String(error));
          throw error;
        })
      : Promise.resolve(null);
    void Promise.all([historyRequest, sourceRequest])
      .catch(error => toast.error(error.message))
      .finally(() => setLoading(false));
  }, [initialMessageId, loadImages, loadPair]);

  useEffect(() => {
    void loadAvailability();
    const timer = window.setInterval(() => void loadAvailability(), 3000);
    return () => window.clearInterval(timer);
  }, [loadAvailability]);

  useEffect(() => {
    if (!source) return;
    const hasActiveComparison = comparisons.some(item => ['pending', 'processing'].includes(item.status || ''));
    const timer = window.setInterval(() => {
      void loadPair(source.messageId, true).then(data => {
        const stillActive = data.comparisons.some((item: ComparisonImage) => ['pending', 'processing'].includes(item.status || ''));
        if (hasActiveComparison && !stillActive) void loadImages();
      }).catch(() => undefined);
    }, hasActiveComparison ? 1800 : 5000);
    return () => window.clearInterval(timer);
  }, [comparisons, loadImages, loadPair, source]);

  useEffect(() => {
    if (!comparisons.some(item => item.status === 'processing')) return;
    setTimerNow(Date.now());
    const timer = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [comparisons]);

  useEffect(() => {
    if (!source) return;
    setSelectedFavorite(currentFavoriteIndex >= 0 ? String(currentFavoriteIndex) : '__current__');
  }, [currentFavoriteIndex, source]);

  const isFinishedVersion = (item?: ComparisonImage | null) => Boolean(
    item?.imageUrl && !['pending', 'processing', 'failed'].includes(item.status || '')
  );
  const canUseSlider = Boolean(
    leftVersion
    && rightVersion
    && isFinishedVersion(leftVersion)
    && isFinishedVersion(rightVersion)
    && leftVersion.messageId !== rightVersion.messageId
    && leftVersion.width
    && leftVersion.height
    && leftVersion.width === rightVersion.width
    && leftVersion.height === rightVersion.height
  );
  const hasSliderPair = versions.some((first, firstIndex) => versions.some((second, secondIndex) => (
    firstIndex !== secondIndex
    && isFinishedVersion(first)
    && isFinishedVersion(second)
    && Boolean(first.width && first.height)
    && first.width === second.width
    && first.height === second.height
  )));
  const selectedPairHasDimensionMismatch = Boolean(
    leftVersion
    && rightVersion
    && isFinishedVersion(leftVersion)
    && isFinishedVersion(rightVersion)
    && leftVersion.messageId !== rightVersion.messageId
    && leftVersion.width
    && leftVersion.height
    && rightVersion.width
    && rightVersion.height
    && (leftVersion.width !== rightVersion.width || leftVersion.height !== rightVersion.height)
  );
  const sliderEnabled = inspectionEnabled && canUseSlider;
  const sliderImagesLoaded = Boolean(
    leftVersion
    && rightVersion
    && loadedSliderImageIds.has(leftVersion.messageId)
    && loadedSliderImageIds.has(rightVersion.messageId)
  );

  useLayoutEffect(() => {
    setSliderPosition(50);
    setSliderZoom(1);
    setSliderPan({ x: 0, y: 0 });
  }, [canUseSlider, leftVersion?.messageId, rightVersion?.messageId]);

  useEffect(() => {
    if (sliderZoom > 1) return;
    setSliderPan(current => current.x === 0 && current.y === 0 ? current : { x: 0, y: 0 });
  }, [sliderZoom]);

  const clampZoom = (value: number) => {
    const bounded = Math.min(5, Math.max(1, value));
    return Math.round(bounded * 100) === 100 ? 1 : bounded;
  };

  const zoomAroundPoint = useCallback((nextZoom: number, point: { x: number; y: number }, bounds: DOMRect) => {
    const boundedZoom = clampZoom(nextZoom);
    if (boundedZoom === 1) {
      setSliderZoom(1);
      setSliderPan({ x: 0, y: 0 });
      return;
    }
    setSliderPan(currentPan => {
      const centerX = bounds.width / 2;
      const centerY = bounds.height / 2;
      const localX = point.x - bounds.left;
      const localY = point.y - bounds.top;
      const worldX = (localX - centerX - currentPan.x) / sliderZoom;
      const worldY = (localY - centerY - currentPan.y) / sliderZoom;
      return {
        x: localX - centerX - worldX * boundedZoom,
        y: localY - centerY - worldY * boundedZoom
      };
    });
    setSliderZoom(boundedZoom);
  }, [sliderZoom]);

  const handleSliderWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAroundPoint(sliderZoom * factor, { x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect());
  }, [sliderZoom, zoomAroundPoint]);

  const getTouchGesture = (event: TouchEvent<HTMLDivElement>) => {
    const first = event.touches[0];
    const second = event.touches[1];
    if (!first || !second) return null;
    return {
      distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
      midpoint: { x: (first.clientX + second.clientX) / 2, y: (first.clientY + second.clientY) / 2 }
    };
  };

  const handleSliderTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const gesture = getTouchGesture(event);
    if (!gesture) return;
    pinchRef.current = { ...gesture, zoom: sliderZoom, pan: sliderPan };
  };

  const handleSliderTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const start = pinchRef.current;
    const gesture = getTouchGesture(event);
    if (!start || !gesture) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextZoom = clampZoom(start.zoom * (gesture.distance / Math.max(1, start.distance)));
    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const startLocalX = start.midpoint.x - bounds.left;
    const startLocalY = start.midpoint.y - bounds.top;
    const nextLocalX = gesture.midpoint.x - bounds.left;
    const nextLocalY = gesture.midpoint.y - bounds.top;
    const worldX = (startLocalX - centerX - start.pan.x) / start.zoom;
    const worldY = (startLocalY - centerY - start.pan.y) / start.zoom;
    setSliderZoom(nextZoom);
    setSliderPan(nextZoom === 1
      ? { x: 0, y: 0 }
      : {
          x: nextLocalX - centerX - worldX * nextZoom,
          y: nextLocalY - centerY - worldY * nextZoom
        });
  };

  const resetSliderZoom = () => {
    setSliderZoom(1);
    setSliderPan({ x: 0, y: 0 });
  };

  const markSliderImageLoaded = (messageId: string) => {
    setLoadedSliderImageIds(current => {
      if (current.has(messageId)) return current;
      const next = new Set(current);
      next.add(messageId);
      return next;
    });
  };

  const handleGridTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return;
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
    if (suppressGridClickTimerRef.current !== null) window.clearTimeout(suppressGridClickTimerRef.current);
    suppressGridClickRef.current = false;
    gridPinchRef.current = {
      startDistance: getTouchDistance(event.touches),
      startColumns: comparisonColumns,
      changed: false
    };
    setIsPinchingGrid(true);
  };

  const handleGridTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || gridPinchRef.current.startDistance === 0) return;
    event.preventDefault();
    const scale = getTouchDistance(event.touches) / gridPinchRef.current.startDistance;
    const delta = Math.round(-Math.log(scale) / Math.log(COMPARISON_PINCH_STEP));
    const next = Math.min(MAX_COMPARISON_COLUMNS, Math.max(MIN_COMPARISON_COLUMNS, gridPinchRef.current.startColumns + delta));
    if (next !== gridPinchRef.current.startColumns) {
      gridPinchRef.current.changed = true;
      suppressGridClickRef.current = true;
    }
    setComparisonColumns(current => current === next ? current : next);
  };

  const handleGridTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (!isPinchingGrid || event.touches.length >= 2) return;
    setIsPinchingGrid(false);
    gridPinchRef.current.startDistance = 0;
    if (!gridPinchRef.current.changed) return;
    suppressGridClickTimerRef.current = window.setTimeout(() => {
      suppressGridClickRef.current = false;
    }, 350);
  };

  const toggleImageSelection = (messageId: string) => {
    setSelectedImageIds(current => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      if (next.size === 0) {
        selectionModeRef.current = false;
        setBatchActionMenuOpen(false);
      }
      return next;
    });
  };

  const cancelLongPress = (pointerId?: number) => {
    if (!longPressRef.current || (pointerId !== undefined && longPressRef.current.pointerId !== pointerId)) return;
    window.clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  };

  const startLongPress = (event: PointerEvent<HTMLButtonElement>, messageId: string) => {
    if (selectedImageIds.size > 0 || event.button !== 0) return;
    cancelLongPress();
    const { pointerId, clientX, clientY } = event;
    const timer = window.setTimeout(() => {
      longPressRef.current = null;
      suppressGridClickRef.current = true;
      selectionModeRef.current = true;
      setSelectedImageIds(new Set([messageId]));
      if ('vibrate' in navigator) navigator.vibrate(35);
      suppressGridClickTimerRef.current = window.setTimeout(() => {
        suppressGridClickRef.current = false;
      }, 400);
    }, COMPARISON_LONG_PRESS_MS);
    longPressRef.current = { timer, messageId, pointerId, startX: clientX, startY: clientY };
  };

  const moveLongPress = (event: PointerEvent<HTMLButtonElement>) => {
    const press = longPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > COMPARISON_LONG_PRESS_MOVE_TOLERANCE) {
      cancelLongPress(event.pointerId);
    }
  };

  const openBatchModelPicker = () => {
    const firstAvailableIndex = favoriteOptions.findIndex(favorite => favorite.workflowFile);
    setSelectedBatchFavorite(firstAvailableIndex >= 0 ? String(firstAvailableIndex) : '');
    setBatchActionMenuOpen(false);
    setBatchModelPickerOpen(true);
  };

  const launchBatch = async () => {
    const favorite = favoriteOptions[Number(selectedBatchFavorite)];
    if (!favorite || !selectedImageIds.size || batchBusy) return;
    setBatchBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/comparisons/batch/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageIds: [...selectedImageIds],
          model: favorite.model,
          modelType: favorite.modelType || 'checkpoint',
          activeModel: currentModel,
          activeModelType: currentModelType
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (fr ? 'Génération par lot impossible' : 'Unable to start batch generation'));
      onModelActivated(favorite);
      setBatchModelPickerOpen(false);
      selectionModeRef.current = false;
      setSelectedImageIds(new Set());
      if (data.queued > 0) toast.success(fr
        ? `${data.queued} ${data.queued > 1 ? 'comparaisons lancées' : 'comparaison lancée'}`
        : `${data.queued} ${data.queued > 1 ? 'comparisons started' : 'comparison started'}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBatchBusy(false);
    }
  };

  const deleteBatch = async () => {
    if (!selectedImageIds.size || batchBusy) return;
    const confirmed = window.confirm(fr
      ? selectedImageIds.size === 1
        ? 'Supprimer toutes les versions de cette comparaison ? La photo originale sera conservée.'
        : `Supprimer toutes les versions des ${selectedImageIds.size} comparaisons sélectionnées ? Les photos originales seront conservées.`
      : selectedImageIds.size === 1
        ? 'Delete every version of this comparison? The original photo will be kept.'
        : `Delete every version of the ${selectedImageIds.size} selected comparisons? The original photos will be kept.`);
    if (!confirmed) return;
    setBatchBusy(true);
    setBatchActionMenuOpen(false);
    try {
      const response = await fetch(`${API_BASE}/api/comparisons/batch`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: [...selectedImageIds] })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (fr ? 'Suppression impossible' : 'Unable to delete'));
      selectionModeRef.current = false;
      setSelectedImageIds(new Set());
      await loadImages();
      toast.success(fr
        ? `${data.deleted} image${data.deleted > 1 ? 's supprimées' : ' supprimée'}`
        : `${data.deleted} image${data.deleted > 1 ? 's' : ''} deleted`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBatchBusy(false);
    }
  };

  const launch = async () => {
    if (!source || !selectedFavorite) return;
    if (selectedFavorite === '__current__') return;
    const favorite = favoriteOptions[Number(selectedFavorite)];
    if (!favorite) return;
    if (usedModels.has(normalizeModelKey(favorite.model))) {
      toast.error(fr ? 'Ce modèle a déjà été comparé.' : 'This model has already been compared.');
      return;
    }
    setLaunching(true);
    try {
      const response = await fetch(`${API_BASE}/api/comparisons/${encodeURIComponent(source.messageId)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: favorite.model,
          modelType: favorite.modelType || 'checkpoint',
          activeModel: currentModel,
          activeModelType: currentModelType
        })
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.comparisonMessageId) {
          await loadPair(data.comparisonMessageId);
        }
        throw new Error(data.error || (fr ? 'Comparaison impossible' : 'Comparison failed'));
      }
      const pendingVersion: ComparisonImage = {
        messageId: data.messageId,
        sessionId: source.sessionId,
        model: favorite.model,
        workflow: favorite.workflowFile,
        width: favorite.generationDefaults?.width || source.width,
        height: favorite.generationDefaults?.height || source.height,
        steps: favorite.generationDefaults?.steps,
        cfg: favorite.generationDefaults?.cfg,
        sampler: favorite.generationDefaults?.sampler,
        scheduler: favorite.generationDefaults?.scheduler,
        seed: source.seed,
        status: 'pending',
        duration: 0,
        comparisonMessageId: source.messageId,
        comparisonSourceId: source.messageId
      };
      setComparisons(current => current.some(item => item.messageId === pendingVersion.messageId)
        ? current
        : [...current, pendingVersion]);
      setRightVersionId(pendingVersion.messageId);
      onModelActivated(favorite);
      toast.success(fr ? 'Comparaison lancée' : 'Comparison started');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLaunching(false);
    }
  };

  const deleteComparison = async (item: ComparisonImage) => {
    if (!source || !item.comparisonSourceId || deletingMessageId) return;
    const confirmed = window.confirm(fr
      ? `Supprimer la version générée avec ${item.model || 'ce modèle'} ?`
      : `Delete the version generated with ${item.model || 'this model'}?`);
    if (!confirmed) return;
    setDeletingMessageId(item.messageId);
    try {
      const response = await fetch(`${API_BASE}/api/comparisons/${encodeURIComponent(item.messageId)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (fr ? 'Suppression impossible' : 'Unable to delete'));
      const transferred = data.transferredFavorite || data.transferredPromptFavorite;
      toast.success(transferred
        ? (fr ? 'Version supprimée, favoris transférés sur l’originale' : 'Version deleted, favorites moved to the original')
        : (fr ? 'Version supprimée' : 'Version deleted'));
      await Promise.all([loadPair(source.messageId), loadImages()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingMessageId(null);
    }
  };

  const renderMeta = (item: ComparisonImage) => {
    const expanded = expandedMetadata.has(item.messageId);
    const detailsId = `comparison-meta-${item.messageId}`;
    return (
      <div className={`comparison-meta ${expanded ? 'expanded' : ''}`}>
        <button
          type="button"
          className="comparison-meta-summary"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpandedMetadata(current => {
            const next = new Set(current);
            if (next.has(item.messageId)) next.delete(item.messageId);
            else next.add(item.messageId);
            return next;
          })}
        >
          <strong>{item.model || '—'}</strong>
          <span className="comparison-meta-chevron" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
            </svg>
          </span>
        </button>
        {expanded && (
          <div id={detailsId} className="comparison-meta-details">
            <span className="comparison-meta-workflow">{item.workflow || '—'}</span>
            <dl>
              <div><dt>Seed</dt><dd>{item.seed ?? '—'}</dd></div>
              <div><dt>{fr ? 'Dimensions' : 'Dimensions'}</dt><dd>{item.width} × {item.height}</dd></div>
              <div><dt>Steps / CFG</dt><dd>{item.steps} / {item.cfg}</dd></div>
              <div><dt>Sampler</dt><dd>{item.sampler || '—'} · {item.scheduler || '—'}</dd></div>
              {item.duration !== undefined && <div><dt>{fr ? 'Durée' : 'Duration'}</dt><dd>{formatDuration(item.duration)}</dd></div>}
            </dl>
          </div>
        )}
      </div>
    );
  };

  if (loading) return <div className="comparison-empty">{fr ? 'Chargement…' : 'Loading…'}</div>;

  if (initialMessageId && sourceLoadError && !source) return (
    <section className="comparison-page" ref={comparisonPageRef}>
      <div className="comparison-source-error">
        <strong>{fr ? 'Impossible d’ouvrir cette image' : 'Unable to open this image'}</strong>
        <p>{sourceLoadError}</p>
        <button type="button" onClick={() => {
          setLoading(true);
          setSourceLoadError(null);
          void loadPair(initialMessageId)
            .catch(error => setSourceLoadError(error instanceof Error ? error.message : String(error)))
            .finally(() => setLoading(false));
        }}>{fr ? 'Réessayer' : 'Retry'}</button>
      </div>
    </section>
  );

  if (!source) return (
    <section className={`comparison-page ${selectedImageIds.size ? 'comparison-selection-mode' : ''}`} ref={comparisonPageRef}>
      <header className="comparison-heading">
        <div><h1>{selectedImageIds.size
          ? (fr ? `${selectedImageIds.size} sélectionnée${selectedImageIds.size > 1 ? 's' : ''}` : `${selectedImageIds.size} selected`)
          : (fr ? 'Mes comparaisons' : 'My comparisons')}</h1></div>
        {selectedImageIds.size ? (
          <button type="button" className="comparison-selection-cancel" onClick={() => {
            selectionModeRef.current = false;
            setSelectedImageIds(new Set());
            setBatchActionMenuOpen(false);
          }}>{fr ? 'Annuler' : 'Cancel'}</button>
        ) : (
          <p>{fr ? 'Une photo principale par comparaison. Maintenez 1 seconde pour sélectionner.' : 'One main photo per comparison. Hold for 1 second to select.'}</p>
        )}
      </header>
      <div
        className={`comparison-picker-grid ${isPinchingGrid ? 'is-pinching' : ''}`}
        style={{ gridTemplateColumns: `repeat(${comparisonColumns}, minmax(0, 1fr))` }}
        onTouchStart={handleGridTouchStart}
        onTouchMove={handleGridTouchMove}
        onTouchEnd={handleGridTouchEnd}
        onTouchCancel={handleGridTouchEnd}
      >
        {isPinchingGrid && (
          <div className="comparison-density-indicator" role="status" aria-live="polite">
            {comparisonColumns} {fr ? (comparisonColumns === 1 ? 'colonne' : 'colonnes') : (comparisonColumns === 1 ? 'column' : 'columns')}
          </div>
        )}
        {images.map(item => {
          const preferenceLabel = item.comparisonPreferenceUpdatedAt == null
            ? null
            : item.comparisonPreferredMessageId === null
              ? '='
              : item.comparisonPreferredMessageId === item.comparisonSourceId
                ? 'A'
                : item.comparisonPreferredMessageId === item.messageId
                  ? getVersionLetter(item.comparisonVersionIndex || 1)
                  : null;
          return (
            <button
              type="button"
              key={item.messageId}
              className={`comparison-picker-item ${selectedImageIds.has(item.messageId) ? 'selected' : ''}`}
              style={{ aspectRatio: item.width && item.height ? `${item.width}/${item.height}` : '1' }}
              aria-pressed={selectedImageIds.size ? selectedImageIds.has(item.messageId) : undefined}
              onPointerDown={event => startLongPress(event, item.messageId)}
              onPointerMove={moveLongPress}
              onPointerUp={event => cancelLongPress(event.pointerId)}
              onPointerCancel={event => cancelLongPress(event.pointerId)}
              onPointerLeave={event => cancelLongPress(event.pointerId)}
              onContextMenu={event => event.preventDefault()}
              onClick={event => {
                if (suppressGridClickRef.current) return;
                if (event.shiftKey && !selectedImageIds.size) {
                  selectionModeRef.current = true;
                  setSelectedImageIds(new Set([item.messageId]));
                  return;
                }
                if (selectionModeRef.current || selectedImageIds.size) toggleImageSelection(item.messageId);
                else void loadPair(item.messageId);
              }}
            >
              <img src={getFullImageUrl(item.thumbnailUrl || item.imageUrl || '')} alt={item.prompt || ''} draggable={false} />
              {selectedImageIds.size > 0 && (
                <span className="comparison-picker-checkbox" aria-hidden="true">
                  {selectedImageIds.has(item.messageId) && (
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m4 10 4 4 8-9" /></svg>
                  )}
                </span>
              )}
              {(item.comparisonVersionCount || 0) >= 3 && (
                <span
                  className="comparison-picker-version-index"
                  title={`${item.comparisonVersionCount} versions`}
                  aria-label={`${item.comparisonVersionCount} versions`}
                >{item.comparisonVersionCount}</span>
              )}
              {preferenceLabel && (
                <span
                  className="comparison-picker-preference"
                  title={fr ? `Appréciation : ${preferenceLabel}` : `Preference: ${preferenceLabel}`}
                  aria-label={fr ? `Appréciation : ${preferenceLabel}` : `Preference: ${preferenceLabel}`}
                >{preferenceLabel}</span>
              )}
            </button>
          );
        })}
      </div>
      {!images.length && <div className="comparison-empty">{fr ? 'Aucune comparaison générée pour le moment.' : 'No generated comparison yet.'}</div>}

      {selectedImageIds.size > 0 && (
        <div className="comparison-batch-bar">
          <button
            type="button"
            className="comparison-batch-action"
            aria-haspopup="menu"
            aria-expanded={batchActionMenuOpen}
            disabled={batchBusy}
            onClick={() => setBatchActionMenuOpen(open => !open)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
            <span>{fr ? 'Actions' : 'Actions'}</span>
            <b>{selectedImageIds.size}</b>
          </button>
          {batchActionMenuOpen && (
            <div className="comparison-batch-menu" role="menu">
              <button type="button" role="menuitem" onClick={openBatchModelPicker} disabled={!favoriteOptions.length || batchBusy}>
                <span className="comparison-batch-menu-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18M3 12h18" /><path d="m5 5 14 14M19 5 5 19" opacity=".35" /></svg>
                </span>
                <span><strong>{fr ? 'Générer par lot' : 'Generate as a batch'}</strong><small>{fr ? 'Comparer la sélection avec un modèle' : 'Compare the selection with one model'}</small></span>
              </button>
              <button type="button" role="menuitem" className="danger" onClick={() => void deleteBatch()} disabled={batchBusy}>
                <span className="comparison-batch-menu-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14" /></svg>
                </span>
                <span><strong>{fr ? 'Supprimer' : 'Delete'}</strong><small>{fr ? 'Supprimer les images sélectionnées' : 'Delete selected images'}</small></span>
              </button>
            </div>
          )}
        </div>
      )}

      {batchModelPickerOpen && (
        <div className="comparison-batch-modal-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget && !batchBusy) setBatchModelPickerOpen(false);
        }}>
          <div className="comparison-batch-modal" role="dialog" aria-modal="true" aria-labelledby="comparison-batch-modal-title">
            <button type="button" className="comparison-batch-modal-close" onClick={() => setBatchModelPickerOpen(false)} disabled={batchBusy} aria-label={fr ? 'Fermer' : 'Close'}>×</button>
            <span className="comparison-batch-modal-kicker">{fr ? 'Génération par lot' : 'Batch generation'}</span>
            <h2 id="comparison-batch-modal-title">{fr ? 'Choisir le modèle' : 'Choose the model'}</h2>
            <p>{fr
              ? `${selectedImageIds.size} image${selectedImageIds.size > 1 ? 's seront analysées' : ' sera analysée'}. Celles déjà traitées avec ce modèle seront simplement ignorées.`
              : `${selectedImageIds.size} selected image${selectedImageIds.size > 1 ? 's' : ''} will be checked. Images already processed with this model will be skipped.`}</p>
            <label htmlFor="comparison-batch-model">{fr ? 'Modèle favori' : 'Favorite model'}</label>
            <select id="comparison-batch-model" value={selectedBatchFavorite} onChange={event => setSelectedBatchFavorite(event.target.value)} disabled={batchBusy}>
              <option value="">{fr ? 'Sélectionner…' : 'Select…'}</option>
              {favoriteOptions.map((favorite, index) => (
                <option key={`${favorite.modelType}:${favorite.model}`} value={index}>{favorite.model}</option>
              ))}
            </select>
            <div className="comparison-batch-modal-actions">
              <button type="button" className="secondary" onClick={() => setBatchModelPickerOpen(false)} disabled={batchBusy}>{fr ? 'Annuler' : 'Cancel'}</button>
              <button type="button" className="primary" onClick={() => void launchBatch()} disabled={!selectedBatchFavorite || batchBusy}>
                {batchBusy ? (fr ? 'Préparation…' : 'Preparing…') : (fr ? 'Lancer le lot' : 'Start batch')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );

  const prompt = source.generationPrompt || source.prompt || source.text || '';
  const selectedModel = selectedFavorite === '__current__'
    ? currentModel
    : favoriteOptions[Number(selectedFavorite)]?.model;
  const selectedAlreadyCompared = Boolean(selectedModel && usedModels.has(normalizeModelKey(selectedModel)));
  const currentModelNeedsFavorite = selectedFavorite === '__current__';
  const busy = launching || !serviceAvailable || (queueRemaining ?? 0) > 0;
  const selectableVersions = versions.filter(isFinishedVersion);
  const activeVersions = comparisons.filter(item => ['pending', 'processing'].includes(item.status || ''));
  const usesNamedPair = versions.length === 2;
  const getVersionDisplayName = (index: number) => usesNamedPair
    ? (index === 0 ? (fr ? 'Originale' : 'Original') : (fr ? 'Nouvelle' : 'New'))
    : getVersionLetter(index);

  const toggleInspection = () => {
    if (!inspectionEnabled && !canUseSlider) {
      for (let firstIndex = 0; firstIndex < selectableVersions.length; firstIndex += 1) {
        const first = selectableVersions[firstIndex];
        const second = selectableVersions.slice(firstIndex + 1).find(item => (
          item.width === first.width && item.height === first.height
        ));
        if (second) {
          setLeftVersionId(first.messageId);
          setRightVersionId(second.messageId);
          break;
        }
      }
    }
    setInspectionEnabled(enabled => !enabled);
  };

  const selectSplitVersion = (side: 'left' | 'right', messageId: string) => {
    if (side === 'left') {
      if (messageId === rightVersionId) setRightVersionId(leftVersionId);
      setLeftVersionId(messageId);
      return;
    }
    if (messageId === leftVersionId) setLeftVersionId(rightVersionId);
    setRightVersionId(messageId);
  };

  const activePairKey = leftVersion && rightVersion
    ? getPairKey(leftVersion.messageId, rightVersion.messageId)
    : '';
  const activePreference = preferences.find(item => (
    getPairKey(item.firstMessageId, item.secondMessageId) === activePairKey
  ));
  const canRatePair = Boolean(
    source
    && leftVersion?.imageUrl
    && rightVersion?.imageUrl
    && leftVersion.messageId !== rightVersion.messageId
  );

  const savePairPreference = async (choice: string | 'tie') => {
    if (!source || !leftVersion || !rightVersion || !canRatePair || savingPreference) return;
    const choiceIsActive = choice === 'tie'
      ? activePreference?.preferredMessageId === null
      : activePreference?.preferredMessageId === choice;
    const nextChoice = choiceIsActive ? null : choice;
    setSavingPreference(true);
    try {
      const response = await fetch(`${API_BASE}/api/comparisons/${encodeURIComponent(source.messageId)}/preference`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstMessageId: leftVersion.messageId,
          secondMessageId: rightVersion.messageId,
          choice: nextChoice
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (fr ? 'Appréciation impossible' : 'Unable to save preference'));
      setPreferences(current => {
        const withoutPair = current.filter(item => (
          getPairKey(item.firstMessageId, item.secondMessageId) !== activePairKey
        ));
        return data.preference ? [...withoutPair, data.preference] : withoutPair;
      });
      const ratedAgainstOriginal = leftVersion.messageId === source.messageId
        ? rightVersion.messageId
        : rightVersion.messageId === source.messageId
          ? leftVersion.messageId
          : null;
      if (ratedAgainstOriginal) {
        setImages(current => current.map(item => item.messageId !== ratedAgainstOriginal
          ? item
          : {
              ...item,
              comparisonPreferredMessageId: data.preference?.preferredMessageId,
              comparisonPreferenceUpdatedAt: data.preference?.updatedAt
            }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingPreference(false);
    }
  };

  const renderDeleteButton = (item: ComparisonImage) => (
    <button
      type="button"
      className="comparison-delete-version"
      disabled={deletingMessageId !== null || ['pending', 'processing'].includes(item.status || '')}
      onClick={() => void deleteComparison(item)}
      title={fr ? 'Supprimer cette version' : 'Delete this version'}
      aria-label={fr ? `Supprimer la version ${item.model || ''}` : `Delete version ${item.model || ''}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 7h16M9 7V4h6v3M8 10v7M12 10v7M16 10v7M6 7l1 14h10l1-14" />
      </svg>
    </button>
  );

  const renderVersionCard = (item: ComparisonImage, index: number) => (
    <article className={`comparison-card comparison-version-card ${['pending', 'processing'].includes(item.status || '') ? 'is-generating' : ''}`} key={item.messageId}>
      <span className="comparison-label">
        {usesNamedPair ? (
          <em>{getVersionDisplayName(index)}</em>
        ) : (
          <>
            <b>{getVersionLetter(index)}</b>
            {index === 0 && <em>{fr ? 'Originale' : 'Original'}</em>}
          </>
        )}
      </span>
      {index > 0 && renderDeleteButton(item)}
      {item.imageUrl ? (
        <img src={getFullImageUrl(item.imageUrl)} alt={`${getVersionLetter(index)} · ${item.model || ''}`} />
      ) : (
        <div className="comparison-generating">
          {item.status !== 'failed' && <span />}
          <strong>{item.status === 'failed' ? (fr ? 'Échec de la génération' : 'Generation failed') : (fr ? 'Génération en cours…' : 'Generating…')}</strong>
          {['pending', 'processing'].includes(item.status || '') && (
            <span className="comparison-generation-timer">
              {formatDuration(getGenerationElapsedSeconds(item.duration, item.generationStartedAt ?? undefined, timerNow))}
            </span>
          )}
          {item.status !== 'failed' && <SeedyCompanion state="working" settings={companionSettings} />}
        </div>
      )}
      {index === 0 && inspectionEnabled && selectedPairHasDimensionMismatch && (
        <p className="comparison-slider-unavailable">{fr
          ? 'Choisissez deux versions terminées ayant les mêmes dimensions.'
          : 'Choose two completed versions with matching dimensions.'}</p>
      )}
      {renderMeta(item)}
    </article>
  );

  return (
    <section className="comparison-page comparison-detail" ref={comparisonPageRef}>
      <header className="comparison-heading compact">
        <button className="comparison-back" onClick={() => { setSource(null); setComparisons([]); setSelectedFavorite(''); }}>
          <span className="comparison-back-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </span>
          <span>{fr ? 'Comparaisons' : 'Comparisons'}</span>
        </button>
        <div className="comparison-title-block"><h1>{fr ? 'Comparaison' : 'Comparison'}</h1></div>
        <button
          type="button"
          className={`comparison-slider-toggle ${inspectionEnabled ? 'active' : ''}`}
          disabled={!hasSliderPair}
          aria-pressed={inspectionEnabled}
          onClick={toggleInspection}
          title={!hasSliderPair
            ? (fr ? 'Nécessite deux images terminées de mêmes dimensions' : 'Requires two completed images with matching dimensions')
            : (fr ? 'Activer ou désactiver le mode Split' : 'Toggle Split mode')}
        >
          <span className="comparison-slider-toggle-icon" aria-hidden="true"><i /><i /><b /></span>
          <span className="comparison-slider-toggle-copy">
            <strong>{fr ? 'Mode Split' : 'Split mode'}</strong>
            <small>{fr ? 'Choisir deux versions' : 'Choose two versions'}</small>
          </span>
          <span className="comparison-slider-toggle-switch" aria-hidden="true"><i /></span>
        </button>
      </header>

      {inspectionEnabled && versions.length > 2 && (
        <div className="comparison-version-selectors">
          {([
            { side: 'left', title: fr ? 'Gauche' : 'Left', selected: leftVersion },
            { side: 'right', title: fr ? 'Droite' : 'Right', selected: rightVersion }
          ] as const).map(selector => (
            <div className={`comparison-version-selector ${selector.side}`} key={selector.side}>
              <div>
                {versions.map(item => {
                  const versionIndex = versions.findIndex(version => version.messageId === item.messageId);
                  const waitingForImage = !isFinishedVersion(item);
                  return (
                    <button
                      type="button"
                      key={item.messageId}
                      className={`${selector.selected?.messageId === item.messageId ? 'active' : ''} ${waitingForImage ? 'pending' : ''} ${usesNamedPair ? 'named' : ''}`}
                      disabled={waitingForImage}
                      onClick={() => selectSplitVersion(selector.side, item.messageId)}
                      title={waitingForImage
                        ? (fr ? `${item.model || getVersionLetter(versionIndex)} — génération en cours` : `${item.model || getVersionLetter(versionIndex)} — generating`)
                        : item.model || getVersionLetter(versionIndex)}
                      aria-label={`${selector.title}: ${getVersionLetter(versionIndex)} · ${item.model || ''}`}
                    >
                      {getVersionDisplayName(versionIndex)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {sliderEnabled && leftVersion?.imageUrl && rightVersion?.imageUrl ? (
        <>
          <div
            className="comparison-slider"
            aria-busy={!sliderImagesLoaded}
            style={{
              aspectRatio: `${leftVersion.width}/${leftVersion.height}`,
              width: `min(100%, 1440px, calc(75vh * ${leftVersion.width! / leftVersion.height!}))`
            }}
            onWheel={handleSliderWheel}
            onTouchStartCapture={handleSliderTouchStart}
            onTouchMoveCapture={handleSliderTouchMove}
            onTouchEndCapture={event => { if (event.touches.length < 2) pinchRef.current = null; }}
          >
            <img
              className="comparison-slider-new"
              style={{ transform: `translate(${sliderPan.x}px, ${sliderPan.y}px) scale(${sliderZoom})` }}
              src={getFullImageUrl(rightVersion.imageUrl)}
              alt={`${fr ? 'Version droite' : 'Right version'} ${rightVersion.model || ''}`}
              onLoad={() => markSliderImageLoaded(rightVersion.messageId)}
            />
            <div className="comparison-slider-original" style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}>
              <img
                style={{ transform: `translate(${sliderPan.x}px, ${sliderPan.y}px) scale(${sliderZoom})` }}
                src={getFullImageUrl(leftVersion.imageUrl)}
                alt={`${fr ? 'Version gauche' : 'Left version'} ${leftVersion.model || ''}`}
                onLoad={() => markSliderImageLoaded(leftVersion.messageId)}
              />
            </div>
            <span className={`comparison-slider-version-badge left ${usesNamedPair ? 'named' : ''}`} aria-hidden="true">
              {getVersionDisplayName(versions.findIndex(item => item.messageId === leftVersion.messageId))}
            </span>
            <span className={`comparison-slider-version-badge right ${usesNamedPair ? 'named' : ''}`} aria-hidden="true">
              {getVersionDisplayName(versions.findIndex(item => item.messageId === rightVersion.messageId))}
            </span>
            <div className="comparison-slider-divider" style={{ left: `${sliderPosition}%` }} aria-hidden="true">
              <span>
                <svg viewBox="0 0 32 24" focusable="false">
                  <path d="M13 5 6 12l7 7M6 12h20M19 5l7 7-7 7" />
                </svg>
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={sliderPosition}
              onChange={event => setSliderPosition(Number(event.target.value))}
              aria-label={fr ? 'Position de la barre de comparaison' : 'Comparison slider position'}
            />
            <div className="comparison-zoom-status" aria-live="polite">
              <span>{Math.round(sliderZoom * 100)}%</span>
              {sliderZoom > 1.001 && (
                <button type="button" onClick={event => { event.stopPropagation(); resetSliderZoom(); }}>
                  {fr ? 'Réinitialiser' : 'Reset'}
                </button>
              )}
            </div>
            {!sliderImagesLoaded && (
              <div className="comparison-slider-loading" role="status" aria-live="polite">
                <span aria-hidden="true" />
                <strong>{fr ? 'Chargement des images…' : 'Loading images…'}</strong>
              </div>
            )}
          </div>
          {activeVersions.length > 0 && (
            <div className="comparison-active-generations">
              {activeVersions.map(item => renderVersionCard(
                item,
                versions.findIndex(version => version.messageId === item.messageId)
              ))}
            </div>
          )}
          {canRatePair && sliderImagesLoaded && (
            <div
              className="comparison-preference"
              role="group"
              aria-label={fr ? 'Appréciation de cette paire' : 'Preference for this pair'}
            >
              <button
                type="button"
                className={activePreference?.preferredMessageId === leftVersion.messageId ? 'active' : ''}
                disabled={savingPreference}
                aria-pressed={activePreference?.preferredMessageId === leftVersion.messageId}
                onClick={() => void savePairPreference(leftVersion.messageId)}
                title={fr ? `${getVersionDisplayName(versions.findIndex(item => item.messageId === leftVersion.messageId))} est meilleure` : `${getVersionDisplayName(versions.findIndex(item => item.messageId === leftVersion.messageId))} is better`}
              >
                <b>{getVersionLetter(versions.findIndex(item => item.messageId === leftVersion.messageId))}</b>
                {!usesNamedPair && <span>{fr ? 'Meilleure' : 'Better'}</span>}
              </button>
              <button
                type="button"
                className={activePreference?.preferredMessageId === null ? 'active' : ''}
                disabled={savingPreference}
                aria-pressed={activePreference?.preferredMessageId === null}
                onClick={() => void savePairPreference('tie')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 9h14M5 15h14" />
                </svg>
                <span>{fr ? 'Égalité' : 'Tie'}</span>
              </button>
              <button
                type="button"
                className={activePreference?.preferredMessageId === rightVersion.messageId ? 'active' : ''}
                disabled={savingPreference}
                aria-pressed={activePreference?.preferredMessageId === rightVersion.messageId}
                onClick={() => void savePairPreference(rightVersion.messageId)}
                title={fr ? `${getVersionDisplayName(versions.findIndex(item => item.messageId === rightVersion.messageId))} est meilleure` : `${getVersionDisplayName(versions.findIndex(item => item.messageId === rightVersion.messageId))} is better`}
              >
                <b>{getVersionLetter(versions.findIndex(item => item.messageId === rightVersion.messageId))}</b>
                {!usesNamedPair && <span>{fr ? 'Meilleure' : 'Better'}</span>}
              </button>
            </div>
          )}
          <div className="comparison-slider-meta">
            {[leftVersion, rightVersion].map(item => {
              const index = versions.findIndex(version => version.messageId === item.messageId);
              return (
                <div className="comparison-slider-meta-card" key={item.messageId}>
                  <div className="comparison-slider-meta-heading">
                    <span className={usesNamedPair ? 'named' : ''}>{getVersionDisplayName(index)}</span>
                    {index > 0 && renderDeleteButton(item)}
                  </div>
                  {renderMeta(item)}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="comparison-versions-grid">
          {versions.map(renderVersionCard)}
        </div>
      )}

      <section className="comparison-add-panel">
        <div className="comparison-add-heading">
          <div>
            <strong>{fr ? 'Ajouter une version' : 'Add a version'}</strong>
            <small>{versions.length} {fr
              ? (versions.length > 1 ? 'versions disponibles' : 'version disponible')
              : (versions.length > 1 ? 'versions available' : 'version available')}</small>
          </div>
          <span>+</span>
        </div>
        <div className="comparison-add-controls">
          <label htmlFor="comparison-model">{fr ? 'Modèle favori' : 'Favorite model'}</label>
          <select id="comparison-model" value={selectedFavorite} onChange={event => setSelectedFavorite(event.target.value)}>
            <option value="">{fr ? 'Sélectionner…' : 'Select…'}</option>
            {currentFavoriteIndex < 0 && currentModel && (
              <option value="__current__" disabled>
                {currentModel} {fr ? '(modèle actuel — non configuré en favori)' : '(current model — not configured as favorite)'}
              </option>
            )}
            {favoriteOptions.map((favorite, index) => {
              const alreadyCompared = usedModels.has(normalizeModelKey(favorite.model));
              return (
                <option key={`${favorite.modelType}:${favorite.model}`} value={index} disabled={alreadyCompared}>
                  {favorite.model}{alreadyCompared ? (fr ? ' (déjà comparé)' : ' (already compared)') : ''}
                </option>
              );
            })}
          </select>
          <button onClick={() => void launch()} disabled={!selectedFavorite || currentModelNeedsFavorite || selectedAlreadyCompared || busy}>
            {launching ? (fr ? 'Préparation…' : 'Preparing…') : (fr ? 'Générer à l’identique' : 'Generate identically')}
          </button>
        </div>
        {selectedAlreadyCompared && <small className="comparison-model-warning">{fr ? 'Ce modèle possède déjà une version. Sélectionnez un autre modèle.' : 'This model already has a version. Select another model.'}</small>}
        {currentModelNeedsFavorite && !selectedAlreadyCompared && <small className="comparison-model-warning">{fr ? 'Le modèle actuel n’est pas associé à un workflow favori.' : 'The current model is not associated with a favorite workflow.'}</small>}
        {(!serviceAvailable || (queueRemaining ?? 0) > 0) && <small>{fr ? 'Disponible lorsque toutes les générations sont terminées.' : 'Available when every generation has finished.'}</small>}
        {!favoriteOptions.length && <small>{fr ? 'Ajoutez d’abord un modèle favori avec un workflow dans les réglages.' : 'First add a favorite model with a workflow in settings.'}</small>}
      </section>

      <div className="comparison-prompt"><strong>Prompt</strong><p>{prompt}</p></div>
      <p className="comparison-note">{fr ? 'Le prompt et la seed sont strictement conservés. Les autres paramètres proviennent du workflow associé au modèle favori. La mémoire ComfyUI n’est libérée que si la comparaison change de modèle.' : 'Prompt and seed are kept unchanged. Other parameters come from the workflow associated with the favorite model. ComfyUI memory is only released when the comparison switches models.'}</p>
    </section>
  );
};
