import React, { useState, useLayoutEffect, useEffect, useRef } from 'react';
import './ChatInterface.css';
import type { Message, Language, GalleryItem, GenParameters, PromptTag } from '../../types';
import { WelcomeScreen } from './WelcomeScreen';
import { MessageText } from './MessageText';
import { SeedyCompanion } from './SeedyCompanion';
import { InfoIcon, RefreshIcon, SendIcon, ChatIcon, PlusIcon, XIcon, ChevronDownIcon, ThumbUpIcon, ComposeIcon, MagicWandIcon } from '../ui/Icons';
import { getFullImageUrl, formatDuration } from '../../services/api';
import { getGenerationElapsedSeconds } from '../../utils/generationTimer';
import toast from 'react-hot-toast';

const LUCKY_PHRASE_COUNT = 5;
const MIN_GALLERY_COLUMNS = 1;
const MAX_GALLERY_COLUMNS = 6;
const GALLERY_PINCH_STEP = 1.16;

const normalizeSearchValue = (value: string) => value
  .toLocaleLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const getTouchDistance = (touches: React.TouchList) => {
  const [first, second] = [touches.item(0), touches.item(1)];
  if (!first || !second) return 0;
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
};

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
  handleSend: (overrideInput?: string, isRegeneration?: boolean, skipEnhancement?: boolean) => void;
  createLuckyGeneration: () => Promise<void>;
  isCreatingLuckyPrompt: boolean;
  regenerationCounts: Record<string, number>;
  recordRegeneration: (messageId: string) => void;
  retryMessage: (messageId: string) => Promise<unknown>;
  retryAllIncomplete: () => Promise<{ queued: number }>;
  interruptGeneration: () => void;
  handleEdit: (text: string) => void;
  goToImage: (sessionId: string, messageId: string) => void;
  setActiveInfoId: (id: string | null) => void;
  activeInfoId: string | null;
  setMessageToDelete: (id: string | null) => void;
  toggleFavorite: (sessionId: string, messageId: string, currentStatus: number | undefined) => void;
  togglePromptFavorite: (sessionId: string, messageId: string, currentStatus: number | undefined) => void;
  handleImageClick: (item: { url: string, thumbnailUrl?: string, sessionId: string, messageId: string, isFavorite?: number, source: 'chat' | 'gallery' }) => void;
  favoritedId: string | null;
  galleryItems: GalleryItem[];
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
  regenerationCounts,
  recordRegeneration,
  retryMessage,
  retryAllIncomplete,
  interruptGeneration,
  handleEdit,
  goToImage,
  setActiveInfoId,
  activeInfoId,
  setMessageToDelete,
  toggleFavorite,
  togglePromptFavorite,
  handleImageClick,
  favoritedId,
  galleryItems,
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
  const [isGallerySearchFocused, setIsGallerySearchFocused] = useState(false);
  const [galleryColumns, setGalleryColumns] = useState(() => {
    const savedColumns = Number.parseInt(localStorage.getItem('galleryColumns') || '', 10);
    if (savedColumns >= MIN_GALLERY_COLUMNS && savedColumns <= MAX_GALLERY_COLUMNS) return savedColumns;
    return window.innerWidth <= 768 ? 3 : 6;
  });
  const [isPinchingGallery, setIsPinchingGallery] = useState(false);
  const promptHighlightRef = useRef<HTMLDivElement>(null);
  const optionsDrawerRef = useRef<HTMLDivElement>(null);
  const optionsToggleRef = useRef<HTMLButtonElement>(null);
  const wasCreatingLuckyPromptRef = useRef(false);
  const galleryPinchRef = useRef({ startDistance: 0, startColumns: galleryColumns, changed: false });
  const suppressGalleryClickRef = useRef(false);
  const suppressGalleryClickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    localStorage.setItem('galleryColumns', String(galleryColumns));
  }, [galleryColumns]);

  useEffect(() => {
    if (openOptionsRequest > 0) setShowOptions(true);
  }, [openOptionsRequest]);

  useEffect(() => () => {
    if (suppressGalleryClickTimerRef.current !== null) {
      window.clearTimeout(suppressGalleryClickTimerRef.current);
    }
  }, []);

  const handleGalleryTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return;
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
    if (!hasActiveGeneration) return;
    setTimerNow(Date.now());
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [messages]);
  
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
      <div className="messages-container" ref={containerRef} onScroll={() => handleScroll(true)}>
        {view === 'chat' || view === 'archives' ? (
          <>
            {messages.length === 0 && (
              view === 'chat' ? <WelcomeScreen lang={lang} /> : <div className="empty-state"><p>{t.noArchives}</p></div>
            )}
            {messages.map((msg, index) => {
              const messageText = msg.text || msg.prompt;
              const prevMsg = index > 0 ? messages[index - 1] : null;
              const prevText = prevMsg ? (prevMsg.text || prevMsg.prompt) : null;
              
              if (!messageText && !msg.imageUrl && msg.status !== 'pending' && msg.status !== 'processing') return null;

              const isRedundant = prevText === messageText;
              const shouldShowText = messageText && (!isRedundant || (msg.role === 'bot' && (msg.isEnhancing || msg.status === 'pending' || msg.status === 'processing')));
              
              return (
                <div key={msg.id} id={`msg-${msg.id}`} className={`message-row ${msg.role}`}>
                  <div className="avatar">{msg.role === 'user' ? 'U' : 'C'}</div>
                  <div className="message-content">
                    {shouldShowText && (
                      <div className="message-text-wrapper">
                        <MessageText text={messageText} lang={lang} />
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
                            {msg.isEnhancing ? t.enhancing : (msg.status === 'processing' ? t.generating : t.waiting)}
                          </span>
                          {!msg.isEnhancing && msg.status === 'processing' && (
                            <span className="generation-live-timer">
                              {formatDuration(getGenerationElapsedSeconds(
                                msg.duration,
                                msg.generationStartedAt,
                                timerNow
                              ))}
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
                              await retryMessage(msg.id);
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
                    </div>
                  )}
                  <div className={`message-actions ${msg.imageUrl ? 'has-image' : ''} ${(regenerationCounts[msg.id] || 0) >= 2 ? 'has-regeneration-count' : ''}`}>
                    <button className="action-btn-icon edit" onClick={() => { 
                      const textToEdit = msg.role === 'user' ? (msg.text || '') : (msg.generationPrompt || msg.prompt || msg.text || '');
                      handleEdit(textToEdit); 
                    }} title={msg.role === 'bot' ? t.reusePrompt : t.edit}>✎</button>
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
            <div className="gallery-header">
              <h2>{t.myContent}</h2>
              <div className="gallery-filters">
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
              </div>
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
                  className="gallery-item" 
                  style={{ 
                    aspectRatio: (item.width && item.height) ? `${item.width}/${item.height}` : 'auto',
                    backgroundColor: 'var(--social-bg)'
                  }}
                  onClick={() => {
                    if (suppressGalleryClickRef.current) return;
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
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
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
                  {item.isFavorite === 1 && <div className="gallery-item-favorite">❤️</div>}
                  {item.isPromptFavorite === 1 && (
                    <div className="gallery-item-prompt-favorite" title={t.likePrompt}>
                      <ThumbUpIcon size={18} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {galleryItems.length === 0 && !isFetchingGallery && <p className="empty-gallery">Aucun contenu généré pour le moment.</p>}
            {isFetchingGallery && <div className="gallery-loader-container"><div className="typing-indicator"><span></span><span></span><span></span></div></div>}
          </div>
        )}
      </div>

      {view === 'chat' && (
        <div className="input-container">
          {showOptions && (
            <div ref={optionsDrawerRef} className="generation-options-drawer fadeIn">
              <div className="options-group lucky-prompt-group">
                <div className="lucky-prompt-actions">
                  <button
                    type="button"
                    className="lucky-prompt-btn"
                    onClick={() => {
                      setShowOptions(false);
                      void createLuckyGeneration();
                    }}
                    disabled={isCreatingLuckyPrompt}
                  >
                    <MagicWandIcon size={17} className="lucky-prompt-icon" />
                    <span>{isCreatingLuckyPrompt ? t.luckyPromptCreating : t.luckyPromptAction}</span>
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
                    <InfoIcon size={16} />
                  </button>
                </div>
                <p className="lucky-prompt-help">{t.luckyPromptHelp}</p>
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
                  onScroll={(e) => syncPromptHighlightScroll(e.currentTarget)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
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
                  <button className={`send-btn ${isGenerating && !input.trim() ? 'stop-btn' : ''}`} onClick={() => isGenerating && !input.trim() ? interruptGeneration() : handleSend()} disabled={!input.trim() && !isGenerating}>
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
