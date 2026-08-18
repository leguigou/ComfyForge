import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let api;
let WelcomeScreen;
let MessageText;
let SeedyCompanion;
let randomPrompts;
let companions;
let generationTimer;
let generationParams;
let promptEnhancement;
let slashCommands;
let config;
let webSocketHelpers;
let moduleRecovery;
let clipboardAutoGenerate;
let runtimeVersionReminder;
let textLanguage;
let manualGalleryGroups;
let messagePairs;
let textClipboard;

before(async () => {
  vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  });

  api = await vite.ssrLoadModule('/src/services/api.ts');
  config = await vite.ssrLoadModule('/src/config.ts');
  randomPrompts = await vite.ssrLoadModule('/src/utils/randomPrompts.ts');
  companions = await vite.ssrLoadModule('/src/utils/companions.ts');
  generationTimer = await vite.ssrLoadModule('/src/utils/generationTimer.ts');
  generationParams = await vite.ssrLoadModule('/src/utils/generationParams.ts');
  promptEnhancement = await vite.ssrLoadModule('/src/utils/promptEnhancement.ts');
  slashCommands = await vite.ssrLoadModule('/src/utils/slashCommands.ts');
  webSocketHelpers = await vite.ssrLoadModule('/src/hooks/useWebSocket.ts');
  moduleRecovery = await vite.ssrLoadModule('/src/utils/moduleRecovery.ts');
  clipboardAutoGenerate = await vite.ssrLoadModule('/src/utils/clipboardAutoGenerate.ts');
  runtimeVersionReminder = await vite.ssrLoadModule('/src/utils/runtimeVersionReminder.ts');
  textLanguage = await vite.ssrLoadModule('/src/utils/textLanguage.ts');
  textClipboard = await vite.ssrLoadModule('/src/utils/textClipboard.ts');
  manualGalleryGroups = await vite.ssrLoadModule('/src/services/manualGalleryGroups.ts');
  messagePairs = await vite.ssrLoadModule('/src/utils/messagePairs.ts');
  ({ WelcomeScreen } = await vite.ssrLoadModule('/src/components/chat/WelcomeScreen.tsx'));
  ({ MessageText } = await vite.ssrLoadModule('/src/components/chat/MessageText.tsx'));
  ({ SeedyCompanion } = await vite.ssrLoadModule('/src/components/chat/SeedyCompanion.tsx'));
});

after(async () => {
  await vite.close();
});

test('formats generation durations and storage sizes', () => {
  assert.equal(api.formatDuration(9), '9s');
  assert.equal(api.formatDuration(65), '1m05s');
  assert.equal(api.formatBytes(0), '0 B');
  assert.equal(api.formatBytes(1024), '1 KB');
});

test('snoozes runtime version reminders for two hours', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const now = 1_000;

  assert.equal(runtimeVersionReminder.isRuntimeVersionReminderSnoozed(storage, now), false);
  const snoozedUntil = runtimeVersionReminder.snoozeRuntimeVersionReminder(storage, now);
  assert.equal(snoozedUntil, now + (2 * 60 * 60 * 1000));
  assert.equal(runtimeVersionReminder.isRuntimeVersionReminderSnoozed(storage, snoozedUntil - 1), true);
  assert.equal(runtimeVersionReminder.isRuntimeVersionReminderSnoozed(storage, snoozedUntil), false);
});

test('normalizes and validates clipboard prompts without accepting unsupported browsers', () => {
  assert.equal(clipboardAutoGenerate.normalizeClipboardPrompt('  first\r\nsecond\u0000  '), 'first\nsecond');
  assert.equal(
    clipboardAutoGenerate.normalizeClipboardPrompt('portrait, <lora:kit_krea2_epoch_05:1>, cinematic light'),
    'portrait, cinematic light'
  );
  assert.equal(
    clipboardAutoGenerate.normalizeClipboardPrompt('<LoRA:first:0.8>, portrait <lora:second:1.2>'),
    'portrait'
  );
  assert.equal(
    clipboardAutoGenerate.normalizeClipboardPrompt('portrait <lora:RLY-thot_shot-ZiB-ZiT-irena-v11-trigger-rlyirena:1>'),
    'portrait'
  );
  assert.equal(clipboardAutoGenerate.normalizeClipboardPrompt('<lora:only_lora:1>'), '');
  assert.equal(clipboardAutoGenerate.isClipboardPromptAllowed('portrait'), true);
  assert.equal(clipboardAutoGenerate.isClipboardPromptAllowed(''), false);
  assert.equal(
    clipboardAutoGenerate.isClipboardPromptAllowed('x'.repeat(clipboardAutoGenerate.MAX_CLIPBOARD_PROMPT_LENGTH + 1)),
    false
  );
  assert.equal(
    clipboardAutoGenerate.isClipboardAutoGenerateSupported({ readText() {}, onclipboardchange: null }, true),
    true
  );
  assert.equal(clipboardAutoGenerate.isClipboardAutoGenerateSupported({ readText() {} }, true), false);
  assert.equal(
    clipboardAutoGenerate.isClipboardAutoGenerateSupported({ readText() {}, onclipboardchange: null }, false),
    false
  );
});

test('wires clipboard permission, change detection, and the general-settings activation control', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const settingsSource = readFileSync('src/components/settings/SettingsModal.tsx', 'utf8');
  const settingsCss = readFileSync('src/components/settings/SettingsModal.css', 'utf8');

  assert.match(appSource, /normalizeClipboardPrompt\(await navigator\.clipboard\.readText\(\)\)/);
  assert.match(appSource, /clipboard\.addEventListener\('clipboardchange', handleClipboardChange\)/);
  assert.match(appSource, /await onHandleSendRef\.current\(prompt\)/);
  assert.match(chatSource, /stripClipboardLoraTags/);
  assert.match(chatSource, /onPaste=\{handlePromptPaste\}/);
  assert.match(settingsSource, /clipboardAutoGenerateTitle/);
  assert.match(settingsSource, /onClipboardAutoGenerateChange\(event\.target\.checked\)/);
  assert.match(appSource, /civitaiMetadataOnDownload:\s*false/);
  assert.match(settingsSource, /checked=\{params\.civitaiMetadataOnDownload\}/);
  assert.match(settingsSource, /civitaiMetadataOnDownload:\s*event\.target\.checked/);
  assert.match(settingsSource, /companion-enabled \$\{companionSettings\.enabled \? 'active' : ''\}/);
  assert.match(settingsCss, /\.clipboard-auto-toggle input\s*\{[\s\S]*?clip-path:\s*inset\(50%\)/);
  assert.match(settingsCss, /\.companion-enabled\.active\s*\{[\s\S]*?background:\s*var\(--accent\)/);
});

test('persists the gallery favorite, liked-prompt, archive, and tag filters', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');

  assert.match(appSource, /localStorage\.getItem\('galleryShowArchived'\) === 'true'/);
  assert.match(appSource, /localStorage\.getItem\('galleryFavoritesOnly'\) === 'true'/);
  assert.match(appSource, /localStorage\.getItem\('galleryPromptFavoritesOnly'\) === 'true'/);
  assert.match(appSource, /JSON\.parse\(localStorage\.getItem\('galleryPromptTags'\) \|\| '\[\]'\)/);
  assert.match(appSource, /localStorage\.setItem\('galleryShowArchived', String\(showArchivedInGallery\)\)/);
  assert.match(appSource, /localStorage\.setItem\('galleryFavoritesOnly', String\(favoritesOnly\)\)/);
  assert.match(appSource, /localStorage\.setItem\('galleryPromptFavoritesOnly', String\(promptFavoritesOnly\)\)/);
  assert.match(appSource, /localStorage\.setItem\('galleryPromptTags', JSON\.stringify\(selectedPromptTags\)\)/);
});

test('distinguishes interface, server, and GitHub versions in update settings', () => {
  const settingsSource = readFileSync('src/components/settings/SettingsModal.tsx', 'utf8');
  const settingsCss = readFileSync('src/components/settings/SettingsModal.css', 'utf8');

  assert.match(settingsSource, /updateInfo\.currentVersion !== APP_CONFIG\.VERSION/);
  assert.match(settingsSource, /update-version-flow[\s\S]*?t\.interfaceVersion[\s\S]*?APP_CONFIG\.VERSION/);
  assert.match(settingsSource, /update-version-flow[\s\S]*?t\.serverVersion[\s\S]*?updateInfo\.currentVersion/);
  assert.match(settingsSource, /update-version-flow[\s\S]*?t\.githubVersion[\s\S]*?updateInfo\.latestVersion/);
  assert.match(settingsSource, /interfaceServerMismatch && \([\s\S]*?t\.interfaceServerVersionMismatch/);
  assert.match(settingsCss, /\.update-version-flow\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 1rem minmax\(0, 1fr\) 1rem minmax\(0, 1fr\)/);
  assert.match(settingsCss, /@media \(hover: hover\)\s*\{[\s\S]*?\.refresh-models-btn:hover:not\(:disabled\)[\s\S]*?\}\s*\}/);
  assert.match(settingsCss, /\.refresh-models-btn:hover:not\(:disabled\)[\s\S]*?\}\s*\}\s*\.update-status-card\s*\{/);
  assert.match(settingsCss, /--update-warning:\s*#f59e0b/);
  assert.match(settingsCss, /\.update-version-node\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/);
});

test('opens update settings when the runtime version warning is selected', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');

  assert.match(appSource, /className="runtime-version-toast-link"[\s\S]*?setActiveTab\('update'\);[\s\S]*?setShowSettings\(true\)/);
  assert.match(appSource, /Voir les détails →/);
});

test('renders the localized welcome screen', () => {
  const french = renderToStaticMarkup(React.createElement(WelcomeScreen, { lang: 'fr' }));
  const english = renderToStaticMarkup(React.createElement(WelcomeScreen, { lang: 'en' }));

  assert.match(french, /Que souhaitez-vous créer/);
  assert.match(french, /Surprends-moi/);
  assert.match(french, /Créer depuis une image/);
  assert.match(french, /Inspire-toi de mes favoris/);
  assert.match(english, /What would you like to create/);
  assert.match(english, /Surprise me/);
  assert.doesNotMatch(french, /Comparer/);
});

test('wires rotating welcome suggestions to existing creation actions', () => {
  const welcomeSource = readFileSync('src/components/chat/WelcomeScreen.tsx', 'utf8');
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');

  assert.match(welcomeSource, /SUGGESTION_ROTATION_MS = 12_000/);
  assert.match(welcomeSource, /current \+ VISIBLE_SUGGESTION_COUNT/);
  assert.match(chatSource, /suggestion === 'surprise' \|\| suggestion === 'remix'/);
  assert.match(chatSource, /void loadSavedPrompt\('favorite'\)/);
  assert.match(chatSource, /const loadLatestPrompt = async/);
  assert.match(chatSource, /onClick=\{openImageImport\}/);
});

test('truncates long message text while keeping short text intact', () => {
  const shortText = 'Portrait cinématique';
  const longText = 'a'.repeat(180);
  const shortMarkup = renderToStaticMarkup(React.createElement(MessageText, { text: shortText, lang: 'fr' }));
  const longMarkup = renderToStaticMarkup(React.createElement(MessageText, { text: longText, lang: 'fr' }));

  assert.match(shortMarkup, /Portrait cinématique/);
  assert.doesNotMatch(shortMarkup, /read-more-btn/);
  assert.match(longMarkup, /class="message-text truncated"/);
  assert.match(longMarkup, /Voir plus/);
  assert.doesNotMatch(longMarkup, new RegExp('a{180}'));
});

test('uses the root VERSION file as the frontend version', () => {
  const rootVersion = readFileSync('../VERSION', 'utf8').trim();
  assert.equal(config.APP_CONFIG.VERSION, rootVersion);
});

test('recognizes stale dynamic module failures without hiding application errors', () => {
  assert.equal(moduleRecovery.isModuleLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/SettingsModal-old.js')), true);
  assert.equal(moduleRecovery.isModuleLoadError(new Error('Unable to preload CSS for /assets/SettingsModal-old.css')), true);
  assert.equal(moduleRecovery.isModuleLoadError(new Error('Settings validation failed')), false);
});

test('keeps development service workers from caching uninjected build placeholders', () => {
  const serviceWorker = readFileSync('public/sw.js', 'utf8');

  assert.match(serviceWorker, /const IS_PRODUCTION_BUILD = !APP_VERSION\.startsWith\('__'\) && !BUILD_ID\.startsWith\('__'\)/);
  assert.match(serviceWorker, /self\.registration\.unregister\(\)/);
  assert.match(serviceWorker, /cacheName\.startsWith\(CACHE_PREFIX\)/);
});

test('serves hashed production assets with long-lived caching and real 404 responses', () => {
  const nginx = readFileSync('nginx.conf', 'utf8');

  assert.match(nginx, /location \/assets\/\s*\{[\s\S]*?try_files \$uri =404;/);
  assert.match(nginx, /location \/assets\/\s*\{[\s\S]*?expires 1y;/);
  assert.match(nginx, /location = \/sw\.js\s*\{[\s\S]*?expires -1;/);
});

test('uses generated thumbnails for profile avatars', () => {
  assert.equal(
    api.getAvatarThumbnailUrl('/api/image-files/user-1/portrait.webp'),
    '/api/image-files/thumbnails/user-1/portrait_thumb.webp'
  );
  assert.equal(
    api.getAvatarThumbnailUrl('/api/image-files/legacy.webp'),
    '/api/image-files/thumbnails/legacy_thumb.webp'
  );
  assert.equal(
    api.getAvatarThumbnailUrl('/api/image-files/thumbnails/user-1/portrait_thumb.webp'),
    '/api/image-files/thumbnails/user-1/portrait_thumb.webp'
  );
  assert.equal(
    api.getAvatarThumbnailUrl('/api/image-files/imports/user-1/source.webp'),
    '/api/image-files/imports/user-1/source.webp'
  );
});

test('loads gallery thumbnails responsively without unnecessary pagination work', () => {
  const thumbnail = '/api/image-files/thumbnails/user-1/portrait_thumb.webp';
  assert.equal(
    api.getThumbnailVariantUrl(thumbnail, 160),
    '/api/image-files/thumbnails/user-1/portrait_thumb-160.webp'
  );
  assert.equal(api.getThumbnailVariantUrl(thumbnail, 400), thumbnail);
  assert.equal(
    api.getThumbnailSrcSet(thumbnail),
    '/api/image-files/thumbnails/user-1/portrait_thumb-160.webp 160w, '
      + '/api/image-files/thumbnails/user-1/portrait_thumb-256.webp 256w, '
      + '/api/image-files/thumbnails/user-1/portrait_thumb.webp 400w'
  );
  assert.equal(api.getThumbnailSrcSet('https://example.com/photo.webp'), undefined);

  const appSource = readFileSync('src/App.tsx', 'utf8');
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const nginx = readFileSync('nginx.conf', 'utf8');
  assert.match(appSource, /const GALLERY_PAGE_SIZE = 48/);
  assert.match(appSource, /includeTotal: String\(isInitial \|\| \(isSeek && !isPrepend\)\)/);
  assert.match(appSource, /includeCursor: 'true'/);
  assert.match(appSource, /target - Math\.floor\(GALLERY_PAGE_SIZE \/ 2\)/);
  assert.match(appSource, /mode: 'replace' \| 'prepend' = 'replace'/);
  assert.match(appSource, /const nextItems = \[\.\.\.loadedItems, \.\.\.galleryItemsRef\.current\]/);
  assert.match(appSource, /container\.scrollTop = previousTop \+ container\.scrollHeight - previousHeight/);
  assert.match(chatSource, /ref=\{firstImageElementRef\} className="gallery-page-sentinel"/);
  assert.match(appSource, /rootMargin: '250px 0px'/);
  assert.match(chatSource, /loading=\{index < galleryColumns \* 3 \? 'eager' : 'lazy'\}/);
  assert.match(chatSource, /fetchPriority=\{index < galleryColumns \? 'high' : 'auto'\}/);
  assert.match(nginx, /location \^~ \/_protected-images\/\s*\{[\s\S]*?internal;/);
});

test('offers a confirmed thumbnail-cache purge in general settings', () => {
  const settingsSource = readFileSync('src/components/settings/SettingsModal.tsx', 'utf8');
  const settingsCss = readFileSync('src/components/settings/SettingsModal.css', 'utf8');
  const translations = readFileSync('src/i18n.ts', 'utf8');

  assert.match(settingsSource, /\/api\/image-files\/thumbnail-cache/);
  assert.match(settingsSource, /method: 'DELETE'/);
  assert.match(settingsSource, /role="alertdialog"/);
  assert.match(settingsSource, /thumbnailCacheConfirmHelp[\s\S]*?replace\('\{count\}'/);
  assert.match(settingsSource, /window\.location\.reload\(\)/);
  assert.match(settingsCss, /\.thumbnail-cache-confirm-overlay\s*\{[\s\S]*?z-index: 3500/);
  assert.match(settingsCss, /\.thumbnail-cache-card\s*\{/);
  assert.match(translations, /thumbnailCacheTitle: 'Cache des miniatures'/);
  assert.match(translations, /thumbnailCacheTitle: 'Thumbnail cache'/);
});

test('shows original-image and thumbnail-cache disk usage in user statistics', () => {
  const statisticsSource = readFileSync('src/components/statistics/StatisticsDashboard.tsx', 'utf8');
  const statisticsCss = readFileSync('src/components/statistics/StatisticsDashboard.css', 'utf8');

  assert.match(statisticsSource, /\/api\/statistics\/storage/);
  assert.match(statisticsSource, /originalImages: 'Images originales'/);
  assert.match(statisticsSource, /thumbnailCache: 'Cache des miniatures'/);
  assert.match(statisticsSource, /formatBytes\(storage\.images\.totalBytes\)/);
  assert.match(statisticsSource, /formatBytes\(storage\.thumbnails\.totalBytes\)/);
  assert.match(statisticsCss, /\.storage-breakdown\s*\{/);
  assert.match(statisticsCss, /@media\(max-width:650px\)[\s\S]*?\.storage-breakdown\{grid-template-columns:1fr\}/);
});

test('loads confirmation dialog styles without opening settings', () => {
  const appCss = readFileSync('src/App.css', 'utf8');
  assert.match(appCss, /\.settings-modal-overlay\s*\{/);
  assert.match(appCss, /\.confirm-modal\s*\{/);
  assert.match(appCss, /\.confirm-btn\.delete\s*\{/);
});

test('deletes empty chats immediately and asks for confirmation only when content exists', () => {
  const sessionsSource = readFileSync('src/hooks/useSessions.ts', 'utf8');

  assert.match(sessionsSource, /\?onlyIfEmpty=true/);
  assert.match(sessionsSource, /response\.status === 409/);
  assert.match(sessionsSource, /setSessionToDelete\(id\)/);
  assert.match(sessionsSource, /confirmDeleteSession[\s\S]*?\/api\/history\/\$\{id\}/);
});

test('locks deletion confirmations and shows progress while requests are pending', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const sessionsSource = readFileSync('src/hooks/useSessions.ts', 'utf8');
  const appCss = readFileSync('src/App.css', 'utf8');
  const translations = readFileSync('src/i18n.ts', 'utf8');

  assert.match(sessionsSource, /deletingSessionRef\.current/);
  assert.match(sessionsSource, /deletingMessageRef\.current/);
  assert.match(sessionsSource, /deletingSessionsScopeRef\.current/);
  assert.match(appSource, /disabled=\{Boolean\(deletingMessageId\)\}/);
  assert.match(appSource, /disabled=\{isDeletingSession\}/);
  assert.match(appSource, /disabled=\{Boolean\(deletingSessionsScope\)\}/);
  assert.match(appSource, /button-inline-loader/);
  assert.match(appSource, /aria-busy=\{isDeletingLightboxImage\}/);
  assert.match(appCss, /\.button-inline-loader\s*\{/);
  assert.match(translations, /deleting: 'Suppression…'/);
  assert.match(translations, /deleting: 'Deleting…'/);
});

test('keeps the lazy settings loader inside the settings modal', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const settingsCss = readFileSync('src/components/settings/SettingsModal.css', 'utf8');

  assert.match(appSource, /const SettingsLoading =/);
  assert.match(appSource, /className="settings-modal settings-panel settings-loading-panel"/);
  assert.match(appSource, /<Suspense fallback=\{\([\s\S]*?<SettingsLoading/);
  assert.match(settingsCss, /\.settings-loading-panel \.settings-loading-content\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;/);
});

test('shows the generation counter from two remaining through the final generation', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');

  assert.match(appSource, /if \(queueRemaining >= 2\)/);
  assert.match(appSource, /else if \(queueRemaining <= 0\)/);
  assert.match(appSource, /showQueueIndicator && \(queueRemaining \?\? 0\) >= 1/);
});

test('focuses the active generation at its exact message after a page refresh', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');

  assert.match(appSource, /performance\.getEntriesByType\('navigation'\)[\s\S]*?type === 'reload'/);
  assert.match(appSource, /const requestMessageAnchor = useCallback[\s\S]*?setImageAnchorRequest/);
  assert.match(appSource, /didFocusActiveGenerationAfterReloadRef\.current = true;\s*void focusActiveGeneration\(\)/);
  assert.match(appSource, /if \(targetIsLoaded\)[\s\S]*?requestMessageAnchor\(target\.messageId\)/);
});

test('keeps regenerate available while an image is pending, preparing, or processing', () => {
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');

  assert.match(chatSource, /const canRegenerateActiveImage = msg\.role === 'bot'[\s\S]*?msg\.status === 'pending'[\s\S]*?msg\.status === 'preparing'[\s\S]*?msg\.status === 'processing'/);
  assert.match(chatSource, /\{canRegenerateActiveImage && regenerationPrompt\.trim\(\) && \([\s\S]*?handleSend\(regenerationPrompt, true\)/);
});

test('keeps a completed thread image in place during rapid regeneration clicks', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const completedImageActions = chatSource.slice(
    chatSource.indexOf('{msg.imageUrl && ('),
    chatSource.indexOf('{canRegenerateActiveImage && regenerationPrompt.trim() && (')
  );

  assert.match(completedImageActions, /Promise\.resolve\(handleSend\(prompt, true, false, false, true\)\)\.catch/);
  assert.match(appSource, /runInBackground\?: boolean[\s\S]*?handleSend\(text, regen, targetSessionId, skipEnhancement, runInBackground, forceEnhancement\)/);
  assert.match(chatSource, /THREAD_REGENERATION_SCROLL_DELAY_MS = 1000/);
  assert.match(chatSource, /scheduleThreadRegenerationScroll[\s\S]*?clearTimeout\(threadRegenerationScrollTimeoutRef\.current\)[\s\S]*?latestMessagesRef\.current\.find\(message =>[\s\S]*?status === 'processing'[\s\S]*?status === 'preparing'[\s\S]*?status === 'pending'[\s\S]*?smoothScrollTo\(`msg-\$\{target\.id\}`\)/);
  assert.match(completedImageActions, /recordRegeneration\(msg\.id\);\s*scheduleThreadRegenerationScroll\(\)/);
});

test('shows random lists from an empty prompt and closes them when existing text is cleared', () => {
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');

  assert.match(chatSource, /const hasPromptText = input\.trim\(\)\.length > 0/);
  assert.match(chatSource, /\{!hasPromptText && \([\s\S]*?ref=\{optionsToggleRef\}/);
  assert.match(chatSource, /\{hasPromptText && \([\s\S]*?ref=\{optionsToggleRef\}/);
  assert.match(chatSource, /\{availableRandomPromptLists\.length > 0 && \(/);
  assert.match(chatSource, /\{showRandomPrompts && \(/);
  assert.match(chatSource, /const hadPromptText = hadPromptTextRef\.current/);
  assert.match(chatSource, /showRandomPrompts && hadPromptText && !hasPromptText/);
});

test('reserves image dimensions behind a dashed loading placeholder', () => {
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const chatCss = readFileSync('src/components/chat/ChatInterface.css', 'utf8');

  assert.match(chatSource, /const reservedImageWidth = msg\.width \|\| params\.width \|\| 512/);
  assert.match(chatSource, /const reservedImageHeight = msg\.height \|\| params\.height \|\| 512/);
  assert.match(chatSource, /aspectRatio: `\$\{reservedImageWidth\}\/\$\{reservedImageHeight\}`/);
  assert.match(chatSource, /width=\{reservedImageWidth\}[\s\S]*?height=\{reservedImageHeight\}/);
  assert.match(chatSource, /className=\{`image-loading-placeholder \$\{isLoaded \? 'is-loaded' : ''\}`\}/);
  assert.match(chatSource, /const isLoaded = loadedSrc === src/);
  assert.match(chatSource, /onLoad=\{\(\) => setLoadedSrc\(src\)\}/);
  assert.match(chatCss, /\.image-loading-placeholder\s*\{[\s\S]*?border:\s*2px dashed[\s\S]*?background:/);
  assert.match(chatCss, /\.image-loading-spinner\s*\{[\s\S]*?animation:\s*reserved-image-spin 0\.8s linear infinite/);
  assert.doesNotMatch(chatCss, /content-visibility:\s*auto/);
});

test('wires vision detail, centered cancellation, stable settings, and exact chat navigation', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const providerSource = readFileSync('src/components/settings/LLMProvidersPanel.tsx', 'utf8');
  const settingsSource = readFileSync('src/components/settings/SettingsModal.tsx', 'utf8');

  assert.match(appSource, /import '\.\/components\/settings\/SettingsModal\.css'/);
  assert.match(appSource, /visionDetailLevel:\s*5/);
  assert.match(chatSource, /detailLevel:\s*params\.visionDetailLevel/);
  assert.match(chatSource, /className="cancel-gen-btn vision-analysis-cancel"/);
  assert.match(providerSource, /className="vision-detail-control"/);
  assert.match(providerSource, /min="1"[\s\S]*?max="5"/);
  assert.match(settingsSource, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(settingsSource, /scrollIntoView/);
  assert.match(appSource, /fetchSessionDetails\(sessionId, \{ all: true, reset: true \}\)/);
  assert.match(appSource, /performance\.now\(\) - startedAt < 15000/);
});

test('keeps fullscreen image navigation available and supports mouse-wheel zoom', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const appCss = readFileSync('src/App.css', 'utf8');

  assert.match(appSource, /const handleLightboxWheel = useCallback/);
  assert.match(appSource, /Math\.exp\(-e\.deltaY \* 0\.0015\)/);
  assert.match(appSource, /Math\.min\(4, Math\.max\(1, zoomScale \* factor\)\)/);
  assert.match(appSource, /onWheel=\{handleLightboxWheel\}/);
  assert.match(appSource, /className="lightbox-btn go-to-chat"[\s\S]*?goToImage\(activeLightbox\.sessionId, activeLightbox\.messageId\)/);
  assert.match(appSource, /if \(source === 'gallery'\)\s*\{\s*goToImage\(sessionId, messageId\)/);
  assert.match(appSource, /else \{\s*closeLightbox\(\)/);
  assert.match(appSource, /const touchedImage = \(e\.target as HTMLElement\)\.closest\('\.lightbox-hd, \.lightbox-thumb'\) !== null/);
  assert.match(appSource, /e\.touches\.length === 0 && zoomScale === 1 && touchedImage[\s\S]*?suppressLightboxClickRef\.current = true/);
  assert.doesNotMatch(appCss, /\.lightbox-btn\.go-to-chat\s*\{[^}]*background:\s*var\(--accent\)/);
  assert.match(appSource, /onTouchStart=\{handleLightboxTouchStart\}[\s\S]*?onTouchMove=\{handleLightboxTouchMove\}/);
});

test('targets cancellation at the selected generation instead of the whole queue', () => {
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const generationSource = readFileSync('src/hooks/useGeneration.ts', 'utf8');

  assert.match(chatSource, /onClick=\{\(\) => interruptGeneration\(msg\.id\)\}/);
  assert.match(generationSource, /body: JSON\.stringify\(\{ messageId \}\)/);
  assert.match(generationSource, /cancelledTemporaryMessages\.current\.delete\(botMsgId\)/);
});

test('deletes a user prompt and its linked generation as one pair in either direction', () => {
  const messages = [
    { id: 'user', role: 'user', text: 'paired prompt', timestamp: 1 },
    { id: 'bot', role: 'bot', text: "Interrompu par l'utilisateur", prompt: 'paired prompt', status: 'failed', timestamp: 2 },
    { id: 'unrelated', role: 'bot', text: 'other', prompt: 'other prompt', status: 'failed', timestamp: 3 },
  ];

  assert.deepEqual(messagePairs.getLinkedMessageIds(messages, 'user'), ['user', 'bot']);
  assert.deepEqual(messagePairs.getLinkedMessageIds(messages, 'bot'), ['user', 'bot']);
  assert.deepEqual(messagePairs.getLinkedMessageIds(messages, 'unrelated'), ['unrelated']);
});

test('opens a conversation-scoped photo gallery from the session menu', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');

  assert.match(appSource, /threadGalleryMatch = pathname\.match\(\/\^\\\/chat\\\/\(\[\^\/\]\+\)\\\/photos\$\/\)/);
  assert.match(appSource, /setView\('thread-gallery'\);[\s\S]*?setShowSessionMenu\(false\)/);
  assert.match(appSource, /view === 'thread-gallery'[\s\S]*?setView\('chat'\)/);
  assert.match(appSource, /view === 'thread-gallery' \? t\.backToThread : t\.threadPhotos/);
  assert.match(appSource, /view === 'thread-gallery' && currentSessionId[\s\S]*?query\.set\('sessionId', currentSessionId\)/);
  assert.match(appSource, /api\/gallery\/group\/\$\{encodeURIComponent\(item\.messageId\)\}\$\{suffix\}/);
  assert.match(chatSource, /const isGalleryView = view === 'gallery' \|\| view === 'thread-gallery'/);
  assert.match(chatSource, /view === 'thread-gallery' \? t\.threadPhotos : t\.myContent/);
  assert.match(chatSource, /view !== 'thread-gallery' && <button[\s\S]*?gallery-filter-round archives/);
});

test('copies text on mobile when the asynchronous clipboard API is unavailable', async () => {
  let copiedValue = '';
  let appendedTextarea;
  const fakeDocument = {
    activeElement: null,
    body: {
      appendChild(element) {
        appendedTextarea = element;
      },
    },
    createElement() {
      return {
        value: '',
        readOnly: false,
        style: {},
        setAttribute() {},
        focus() {},
        select() {},
        setSelectionRange() {},
        remove() {},
      };
    },
    execCommand(command) {
      assert.equal(command, 'copy');
      copiedValue = appendedTextarea.value;
      return true;
    },
  };

  await textClipboard.copyTextToClipboard('texte mobile', undefined, fakeDocument);
  assert.equal(copiedValue, 'texte mobile');
});

test('falls back to text selection when the exposed clipboard API rejects', async () => {
  let fallbackUsed = false;
  const fakeDocument = {
    activeElement: null,
    body: { appendChild() {} },
    createElement() {
      return {
        value: '', readOnly: false, style: {},
        setAttribute() {}, focus() {}, select() {}, setSelectionRange() {}, remove() {},
      };
    },
    execCommand() {
      fallbackUsed = true;
      return true;
    },
  };

  await textClipboard.copyTextToClipboard('fallback', { writeText: async () => { throw new Error('denied'); } }, fakeDocument);
  assert.equal(fallbackUsed, true);
});

test('opens gallery image actions on right click with prompt-aware regeneration and red deletion', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const chatCss = readFileSync('src/components/chat/ChatInterface.css', 'utf8');
  const galleryMenuSource = chatSource.slice(
    chatSource.indexOf('{galleryImageContextMenu && ('),
    chatSource.indexOf('{textTranslation && (')
  );

  assert.match(chatSource, /onContextMenu=\{event => openGalleryImageContextMenu\(event, item, canSelect\)\}/);
  assert.match(chatSource, /const regenerateGalleryContextImage = async \(\) => \{[\s\S]*?batchRegenerateGalleryItems\(\[target\]\)/);
  assert.match(galleryMenuSource, /t\.regenerate[\s\S]*?t\.imageInformation[\s\S]*?t\.viewPrompt[\s\S]*?className="text-context-menu-item danger"[\s\S]*?t\.delete/);
  assert.match(appSource, /const openGalleryImagePanel = useCallback[\s\S]*?pendingLightboxPanelRef\.current = panel[\s\S]*?setActiveLightbox/);
  assert.match(appSource, /const pendingPanel = activeLightbox \? pendingLightboxPanelRef\.current : null[\s\S]*?setShowLightboxPrompt\(pendingPanel === 'prompt'\)[\s\S]*?setShowLightboxInfo\(pendingPanel === 'information'\)/);
  assert.match(chatCss, /\.text-context-menu-item\.danger\s*\{[^}]*color:\s*#ff5c67/);
});

test('offers batch generation and deletion alongside single-image information actions', () => {
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const batchMenuSource = chatSource.slice(
    chatSource.indexOf('{galleryBatchMenuOpen && ('),
    chatSource.indexOf('{isGalleryView && galleryTotal > 1')
  );

  assert.match(chatSource, /const openSelectedGalleryPanel = \(panel: 'information' \| 'prompt'\) => \{[\s\S]*?selectedGalleryItems\.length !== 1[\s\S]*?openGalleryImagePanel\(target, panel\)/);
  assert.match(batchMenuSource, /batchRegenerateGalleryItems\(selectedGalleryItems\)[\s\S]*?disabled=\{galleryBatchBusy\}/);
  assert.match(batchMenuSource, /openSelectedGalleryPanel\('information'\)[\s\S]*?disabled=\{galleryBatchBusy \|\| selectedGalleryItems\.length !== 1\}[\s\S]*?t\.imageInformation/);
  assert.match(batchMenuSource, /openSelectedGalleryPanel\('prompt'\)[\s\S]*?selectedGalleryItems\.length !== 1[\s\S]*?t\.viewPrompt/);
  assert.match(batchMenuSource, /className="danger"[\s\S]*?containsGroups = selectedGalleryItems\.some[\s\S]*?t\.batchDeleteGlobalConfirm[\s\S]*?disabled=\{galleryBatchBusy\}/);
  assert.match(batchMenuSource, /t\.batchRegenerate[\s\S]*?t\.imageInformation[\s\S]*?t\.viewPrompt[\s\S]*?\{!selectionContainsPromptGroup && <>[\s\S]*?t\.batchLucky[\s\S]*?<\/>\}[\s\S]*?className="danger"/);
});

test('keeps touch long press in gallery selection mode while mouse right click opens image actions', () => {
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');

  assert.match(chatSource, /galleryPointerTypeRef\.current = event\.pointerType/);
  assert.match(chatSource, /const activateGallerySelection = \(messageId: string\) => \{[\s\S]*?gallerySelectionModeRef\.current = true[\s\S]*?setSelectedGalleryIds/);
  assert.match(chatSource, /const openGalleryImageContextMenu[\s\S]*?pointerType !== 'mouse'[\s\S]*?activateGallerySelection\(item\.messageId\)[\s\S]*?setGalleryImageContextMenu/);
  assert.match(chatSource, /onContextMenu=\{event => openGalleryImageContextMenu\(event, item, canSelect\)\}/);
  assert.match(chatSource, /selectedGalleryIds\.size > 0 && \([\s\S]*?className="gallery-batch-bar"/);
});

test('replaces the native long-press image menu with lightbox actions', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const appCss = readFileSync('src/App.css', 'utf8');
  const imageClipboardSource = readFileSync('src/utils/imageClipboard.ts', 'utf8');

  assert.match(appSource, /const handleLightboxContextMenu = useCallback[\s\S]*?event\.preventDefault\(\)[\s\S]*?setLightboxContextMenu/);
  assert.match(appSource, /className="lightbox-content"[^>]*onContextMenu=\{handleLightboxContextMenu\}/);
  assert.match(appSource, /className="lightbox-thumb" draggable=\{false\}/);
  assert.match(appSource, /className="lightbox-hd" draggable=\{false\}/);
  assert.match(appCss, /\.lightbox-thumb, \.lightbox-hd\s*\{[^}]*-webkit-touch-callout:\s*none;[^}]*user-select:\s*none;/);
  assert.match(appSource, /className="lightbox-context-menu"[\s\S]*?featureCurrentGroupImage[\s\S]*?setShowLightboxInfo\(true\)[\s\S]*?copyLightboxImage[\s\S]*?downloadImage/);
  assert.match(appSource, /const copyLightboxImage = useCallback[\s\S]*?copyImageToClipboard[\s\S]*?t\.imageCopied/);
  assert.match(imageClipboardSource, /const pngPromise = fetch/);
  assert.match(imageClipboardSource, /new ClipboardItem\(\{ 'image\/png': pngPromise \}\)/);
  assert.match(appSource, /className="lightbox-prompt-panel lightbox-info-panel"[\s\S]*?currentLightboxMetadata\.map/);
  assert.match(appCss, /\.lightbox-context-menu-shell\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*45/);
});

test('offers a confirmed red image deletion action at the bottom of both lightbox menus', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const appCss = readFileSync('src/App.css', 'utf8');

  assert.equal((appSource.match(/className="lightbox-menu-item danger"/g) || []).length, 2);
  assert.match(appSource, /const requestLightboxImageDeletion = \(\) => \{[\s\S]*?setLightboxImageToDelete/);
  assert.match(appSource, /const confirmLightboxImageDeletion = async \(\) => \{[\s\S]*?method: 'DELETE'[\s\S]*?fetchGallery\(false, refreshOffset\)/);
  assert.match(appSource, /lightboxImageToDelete && \([\s\S]*?confirmLightboxImageDeletion\(\)/);
  assert.match(appCss, /\.lightbox-menu-item\.danger\s*\{[^}]*color:\s*#ff6f78/);
});

test('keeps gallery lightbox navigation and counters aligned after deleting an image', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const handlerStart = appSource.indexOf('const confirmLightboxImageDeletion = async');
  const handlerEnd = appSource.indexOf('const featureCurrentGroupImage = async', handlerStart);
  const handlerSource = appSource.slice(handlerStart, handlerEnd);

  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(handlerSource, /const remainingGroup = groupBeforeDelete\.filter/);
  assert.match(handlerSource, /groupCount: remainingGroup\.length/);
  assert.match(handlerSource, /galleryEntryWasRemoved = false/);
  assert.match(handlerSource, /if \(galleryEntryWasRemoved\) \{[\s\S]*?setGalleryTotal\(total => Math\.max\(0, total - 1\)\)/);
  assert.match(handlerSource, /fetchGallery\(false, refreshOffset\)/);
  assert.match(handlerSource, /setActiveLightbox\(nextGalleryItem \? \{[\s\S]*?source: 'gallery'/);
});

test('distinguishes manual gallery groups without recoloring their count', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const chatCss = readFileSync('src/components/chat/ChatInterface.css', 'utf8');

  assert.match(appSource, /manualGroupId\?\.trim\(\)[\s\S]*?return `__manual__:/);
  assert.match(chatSource, /PromptGroupIcon size=\{13\} className=\{item\.manualGroupId \? 'manual-gallery-group-icon' : undefined\}/);
  assert.match(chatSource, /const canSelect = !groupByPrompt \|\| !item\.manualGroupId/);
  assert.match(chatSource, /onPointerDown=\{event => \{[\s\S]*?galleryPointerTypeRef\.current = event\.pointerType;[\s\S]*?if \(canSelect\) startGalleryLongPress/);
  assert.match(chatSource, /selectedGalleryIds\.size > 0 && canSelect &&/);
  assert.match(chatSource, /selectionContainsPromptGroup = selectedGalleryItems\.some/);
  assert.match(chatSource, /!selectionContainsPromptGroup && <>/);
  assert.match(appSource, /helpers\.createPositionedGroup\(/);
  assert.match(appSource, /refreshGalleryRef\.current\?\.\(centeredOffset\)\.then/);
  assert.match(chatCss, /\.gallery-group-count \.manual-gallery-group-icon\s*\{[^}]*color:\s*#4da3ff/);
  assert.doesNotMatch(chatCss, /\.gallery-group-count\.manual[^}]*color:/);
});

test('keeps a newly created manual group centered after refreshing the gallery', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const handlerStart = appSource.indexOf('const batchCreateManualGroup = useCallback');
  const handlerEnd = appSource.indexOf('const batchDeleteGalleryItems', handlerStart);
  const handlerSource = appSource.slice(handlerStart, handlerEnd);

  assert.equal(manualGalleryGroups.getCenteredGalleryOffset(5, 200, 48), 0);
  assert.equal(manualGalleryGroups.getCenteredGalleryOffset(125, 200, 48), 101);
  assert.equal(manualGalleryGroups.getCenteredGalleryOffset(195, 200, 48), 152);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(handlerSource, /galleryStartIndexRef\.current/);
  assert.match(handlerSource, /helpers\.centerGroupAfterRender\(containerRef\.current, coverId\)/);
  const helpersSource = readFileSync('src/services/manualGalleryGroups.ts', 'utf8');
  assert.match(helpersSource, /querySelectorAll<HTMLElement>\('\[data-gallery-message-id\]'\)/);
  assert.match(helpersSource, /candidate\.dataset\.galleryMessageId === messageId/);
  assert.match(helpersSource, /targetScroll = elementTop - \(container\.clientHeight - elementRect\.height\) \/ 2/);
  assert.match(helpersSource, /behavior: 'smooth'/);
  assert.match(helpersSource, /centerGalleryItem\(container, messageId\) \|\| attempts <= 0/);
});

test('expands selected prompt groups before creating a manual group', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    const messageId = String(url).split('/').at(-1);
    return new Response(JSON.stringify({
      items: [{ messageId }, { messageId: `${messageId}-second` }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const ids = await manualGalleryGroups.expandGalleryGroupMessageIds([
      { messageId: 'prompt-a', groupCount: 4 },
      { messageId: 'single', groupCount: 1 },
      { messageId: 'prompt-b', groupCount: 2 },
    ]);
    assert.deepEqual(ids, ['prompt-a', 'prompt-a-second', 'single', 'prompt-b', 'prompt-b-second']);
    assert.equal(requested.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('expands every selected gallery group before global deletion', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return new Response(JSON.stringify({
      items: [
        { messageId: 'cover', sessionId: 'session-a' },
        { messageId: 'member', sessionId: 'session-b' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const items = await manualGalleryGroups.expandGalleryGroupItems([
      { messageId: 'cover', sessionId: 'session-a', groupCount: 2 },
      { messageId: 'single', sessionId: 'session-c', groupCount: 1 },
    ]);
    assert.deepEqual(items.map(item => [item.messageId, item.sessionId]), [
      ['cover', 'session-a'],
      ['member', 'session-b'],
      ['single', 'session-c'],
    ]);
    assert.equal(requested.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('toggles a fullscreen image favorite on double click', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');

  assert.match(appSource, /const handleLightboxImageDoubleClick = useCallback/);
  assert.match(appSource, /closest\('\.lightbox-hd, \.lightbox-thumb'\)/);
  assert.doesNotMatch(appSource, /if \(currentItem\?\.isFavorite === 1\) return;/);
  assert.match(appSource, /toggleFavorite\(activeLightbox\.sessionId, activeLightbox\.messageId, currentItem\?\.isFavorite\)/);
  assert.match(appSource, /onDoubleClick=\{handleLightboxImageDoubleClick\}/);
});

test('closes the lightbox action menu when the fullscreen image is tapped', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const handlerStart = appSource.indexOf('const handleLightboxImageClick = useCallback');
  const handlerEnd = appSource.indexOf('const handleLightboxImageDoubleClick', handlerStart);
  const handlerSource = appSource.slice(handlerStart, handlerEnd);

  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.ok(handlerSource.indexOf('if (showLightboxMenu)') < handlerSource.indexOf('if (suppressLightboxClickRef.current)'));
  assert.match(handlerSource, /if \(showLightboxMenu\) \{[\s\S]*?setShowLightboxMenu\(false\);[\s\S]*?e\.stopPropagation\(\);[\s\S]*?return;/);
});

test('dismisses the long-press image menu with a close action or an outside pointer', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');

  assert.match(appSource, /const handleLightboxPointerDown = useCallback[\s\S]*?closest\('\.lightbox-context-menu-shell'\)[\s\S]*?setLightboxContextMenu\(null\)/);
  assert.match(appSource, /className=\{`lightbox[\s\S]*?onPointerDown=\{handleLightboxPointerDown\}/);
  assert.match(appSource, /className="lightbox-context-menu-shell"[\s\S]*?className="lightbox-context-menu-close"[\s\S]*?aria-label=\{t\.close\}[\s\S]*?setLightboxContextMenu\(null\)[\s\S]*?<XIcon size=\{20\}/);
});

test('keeps the lightbox regeneration menu open until one second after the last click', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');

  assert.match(appSource, /const scheduleLightboxMenuClose = useCallback\([\s\S]*?window\.clearTimeout\(lightboxMenuCloseTimeoutRef\.current\)[\s\S]*?setShowLightboxMenu\(false\);[\s\S]*?}, 1000\)/);
  assert.match(appSource, /const regenerateLightboxImage = async \(\) => \{[\s\S]*?scheduleLightboxMenuClose\(\);\s*recordRegeneration\(messageId\)/);
  assert.match(appSource, /onClick=\{\(\) => void regenerateLightboxImage\(\)\}/);
});

test('lets the final prompt scroll on touch devices without closing the lightbox', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const appCss = readFileSync('src/App.css', 'utf8');

  assert.match(appSource, /className="lightbox-prompt-panel"[\s\S]*?onTouchStart=\{\(event\) => event\.stopPropagation\(\)\}[\s\S]*?onTouchMove=\{\(event\) => event\.stopPropagation\(\)\}[\s\S]*?onTouchEnd=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(appCss, /\.lightbox-prompt-panel\s*\{[^}]*overflow:\s*auto;[^}]*touch-action:\s*pan-y;[^}]*overscroll-behavior-y:\s*contain;[^}]*-webkit-overflow-scrolling:\s*touch;/);
});

test('opens My Content and adds the selected lightbox tag without removing existing tags', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const appCss = readFileSync('src/App.css', 'utf8');

  assert.match(appSource, /const openPromptTag = useCallback[\s\S]*?setSelectedPromptTags\(current => current\.includes\(slug\) \? current : \[\.\.\.current, slug\]\)[\s\S]*?setActiveLightbox\(null\)[\s\S]*?setView\('gallery'\)/);
  assert.match(appSource, /className="lightbox-prompt-tags-list"[\s\S]*?<button[\s\S]*?onClick=\{\(\) => openPromptTag\(tag\.slug\)\}[\s\S]*?aria-label=\{`\$\{t\.filterByTag\}/);
  assert.match(appCss, /\.lightbox-prompt-tags-list button\s*\{[\s\S]*?cursor:\s*pointer/);
});

test('uses stacked, bounded admin cards on mobile settings screens', () => {
  const queueCss = readFileSync('src/components/settings/AdminQueuePanel.css', 'utf8');
  const settingsCss = readFileSync('src/components/settings/SettingsModal.css', 'utf8');

  assert.match(queueCss, /\.admin-queue-panel\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%/);
  assert.match(queueCss, /@media \(max-width:\s*640px\)[\s\S]*?\.admin-queue-summary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(queueCss, /\.admin-queue-summary span\s*\{[\s\S]*?gap:\s*0\.25rem/);
  assert.match(queueCss, /\.admin-queue-item p\s*\{[\s\S]*?-webkit-line-clamp:\s*3/);
  assert.match(settingsCss, /grid-template-areas:\s*"level source direction duration"\s*"time time time time"\s*"message message message message"/);
  assert.match(settingsCss, /\.admin-log-message\s*\{[\s\S]*?white-space:\s*normal;[\s\S]*?-webkit-line-clamp:\s*2/);
});

test('keeps large settings data out of generation requests', () => {
  const requestParams = generationParams.toGenerationRequestParams({
    comfyModel: 'model.safetensors',
    comfyModelType: 'checkpoint',
    comfyUrl: 'http://127.0.0.1:8188',
    workflowFile: 'workflow.json',
    width: 1024,
    height: 1024,
    steps: 20,
    cfg: 4,
    sampler: 'euler',
    scheduler: 'normal',
    negativePrompt: 'default negative',
    nodeMapping: { positive: '1', ksampler: '2' },
    seedMode: 'fixed',
    forcedSeed: '42',
    randomPromptLists: [{ id: 'large', name: 'Large', slug: 'R-Large', values: ['x'.repeat(3_000_000)], enabled: true }],
    favoriteModels: [],
    companionSettings: { enabled: true, activeId: 'custom', companions: [{ id: 'custom', name: 'Custom', source: 'custom', spriteDataUrl: 'x'.repeat(3_000_000) }] },
    llmUrl: '',
    llmModel: '',
    llmSystemMessage: 'x'.repeat(3_000_000),
    llmEnabled: false,
    visionSystemMessage: '',
    visionModelTtlMinutes: 0,
    luckyTemperature: 0.9,
    luckyFavoriteCount: 4,
  }, { negativePrompt: 'request negative' });

  assert.equal(requestParams.seed, 42);
  assert.equal(requestParams.negativePrompt, 'request negative');
  assert.equal(requestParams.comfyModel, 'model.safetensors');
  assert.equal('randomPromptLists' in requestParams, false);
  assert.equal('companionSettings' in requestParams, false);
  assert.ok(JSON.stringify(requestParams).length < 2_000);
});

test('adds new default random lists once when migrating existing settings', () => {
  const existing = randomPrompts.DEFAULT_RANDOM_PROMPT_LISTS.filter(list =>
    list.id !== 'hairstyle' && list.id !== 'country-origin'
  );
  const migrated = randomPrompts.migrateRandomPromptLists(existing, 1);
  const migratedAgain = randomPrompts.migrateRandomPromptLists(migrated, randomPrompts.RANDOM_PROMPT_LISTS_VERSION);

  assert.equal(migrated.filter(list => list.id === 'hairstyle').length, 1);
  assert.equal(migrated.find(list => list.id === 'hairstyle').slug, 'R-Hairstyle');
  assert.equal(migrated.filter(list => list.id === 'country-origin').length, 1);
  assert.equal(migrated.find(list => list.id === 'country-origin').slug, 'R-Origin');
  assert.deepEqual(migratedAgain, migrated);
});

test('adds the origin random list to version 2 settings', () => {
  const existing = randomPrompts.DEFAULT_RANDOM_PROMPT_LISTS.filter(list => list.id !== 'country-origin');
  const migrated = randomPrompts.migrateRandomPromptLists(existing, 2);

  assert.equal(migrated.filter(list => list.id === 'country-origin').length, 1);
  assert.equal(migrated.find(list => list.id === 'country-origin').values.includes('french'), true);
  assert.equal(migrated.find(list => list.id === 'country-origin').values.includes('american'), true);
  assert.equal(migrated.find(list => list.id === 'country-origin').values.includes('italian'), true);
});

test('returns the random values selected while resolving a prompt template', () => {
  const lists = [{ id: 'hair', name: 'Coiffures', slug: 'R-Hair', values: ['long hair'], enabled: true }];
  const result = randomPrompts.resolveRandomPromptsWithSelections('[R-Hair], portrait with [R-Hair]', lists);

  assert.equal(result.prompt, 'long hair, portrait with long hair');
  assert.deepEqual(result.selections, [{ listId: 'hair', name: 'Coiffures', slug: 'R-Hair', value: 'long hair' }]);
});

test('migrates and preserves companion settings', () => {
  const defaults = companions.normalizeCompanionSettings();
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.activeId, companions.DEFAULT_COMPANION_ID);

  const customized = companions.normalizeCompanionSettings({
    enabled: false,
    activeId: 'custom-one',
    companions: [
      { id: companions.DEFAULT_COMPANION_ID, name: 'Pousse', source: 'builtin' },
      { id: 'custom-one', name: 'Pixel', source: 'custom', spriteUrl: '/api/companions/custom-one', spriteBytes: 1234 },
    ],
  });

  assert.equal(customized.enabled, false);
  assert.equal(customized.companions[0].name, 'Pousse');
  assert.equal(customized.activeId, 'custom-one');
  assert.equal(customized.companions[1].name, 'Pixel');
  assert.equal(customized.companions[1].spriteUrl, '/api/companions/custom-one');

  const markup = renderToStaticMarkup(React.createElement(SeedyCompanion, {
    state: 'working',
    settings: { ...customized, enabled: true },
  }));
  assert.match(markup, /\/api\/companions\/custom-one/);
});

test('keeps companion sprites animated when reduced motion is enabled', () => {
  const css = readFileSync('src/components/chat/SeedyCompanion.css', 'utf8');
  const reducedMotionRules = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

  assert.match(reducedMotionRules, /animation-duration:\s*12s\s*!important/);
  assert.match(reducedMotionRules, /animation-duration:\s*3s\s*!important/);
  assert.match(reducedMotionRules, /animation-duration:\s*6s\s*!important/);
  assert.match(reducedMotionRules, /animation-iteration-count:\s*infinite\s*!important/);
});

test('keeps the loading dots visible and animated with reduced motion', () => {
  const css = readFileSync('src/components/ui/Icons.css', 'utf8');
  const reducedMotionRules = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

  assert.match(reducedMotionRules, /\.bounce1,\s*\.bounce2,\s*\.bounce3/);
  assert.match(reducedMotionRules, /animation-duration:\s*2\.8s\s*!important/);
  assert.match(reducedMotionRules, /animation-iteration-count:\s*infinite\s*!important/);
});

test('keeps the imported-image scanner animated with reduced motion', () => {
  const css = readFileSync('src/components/chat/ChatInterface.css', 'utf8');
  const scannerRules = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));

  assert.match(scannerRules, /\.vision-scan-line/);
  assert.match(scannerRules, /animation-duration:\s*3\.6s\s*!important/);
  assert.match(scannerRules, /\.vision-pixel-cloud/);
  assert.match(scannerRules, /\.vision-live-dot/);
  assert.equal((scannerRules.match(/animation-iteration-count:\s*infinite\s*!important/g) || []).length, 3);
});

test('does not globally cancel loaders and continuous status animations', () => {
  const globalCss = readFileSync('src/index.css', 'utf8');
  const appCss = readFileSync('src/App.css', 'utf8');
  const sidebarCss = readFileSync('src/components/sidebar/Sidebar.css', 'utf8');

  assert.doesNotMatch(globalCss, /animation-duration:\s*0\.01ms\s*!important/);
  assert.doesNotMatch(globalCss, /animation-iteration-count:\s*1\s*!important/);
  assert.match(appCss, /\.workspace-loading span\s*\{[\s\S]*?animation-duration:\s*1\.6s\s*!important;[\s\S]*?animation-iteration-count:\s*infinite\s*!important/);
  assert.match(sidebarCss, /\.session-processing-loader\s*\{[\s\S]*?animation-duration:\s*1\.5s\s*!important;[\s\S]*?animation-iteration-count:\s*infinite\s*!important/);
});

test('aligns the sidebar navigation labels with equal-sized icon slots', () => {
  const sidebarSource = readFileSync('src/components/sidebar/Sidebar.tsx', 'utf8');
  const sidebarCss = readFileSync('src/components/sidebar/Sidebar.css', 'utf8');

  assert.match(sidebarSource, /sidebar-nav-icon new-chat-icon[\s\S]*?<PlusIcon size=\{13\}/);
  assert.equal((sidebarSource.match(/className="sidebar-nav-icon"/g) || []).length, 2);
  assert.match(sidebarCss, /\.new-chat-btn \.sidebar-nav-icon\s*\{[\s\S]*?flex:\s*0 0 20px;[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px/);
  assert.match(sidebarCss, /\.new-chat-btn \.new-chat-icon\s*\{[\s\S]*?border-radius:\s*50%/);
});

test('separates the desktop gallery fast navigator from the native scrollbar', () => {
  const chatCss = readFileSync('src/components/chat/ChatInterface.css', 'utf8');
  const desktopRulesStart = chatCss.indexOf('@media (min-width: 769px)', chatCss.indexOf('.gallery-fast-scroll {'));
  const desktopRules = chatCss.slice(desktopRulesStart, chatCss.indexOf('.gallery-fast-scroll-rail', desktopRulesStart));

  assert.match(desktopRules, /\.gallery-fast-scroll\s*\{[\s\S]*?right:\s*max\(26px,/);
  assert.match(desktopRules, /\.gallery-fast-scroll::before\s*\{[\s\S]*?width:\s*16px;[\s\S]*?border:/);
});

test('keeps the archive view active when opening an archived conversation', () => {
  const sidebarSource = readFileSync('src/components/sidebar/Sidebar.tsx', 'utf8');

  assert.match(sidebarSource, /setCurrentSessionId\(s\.id\);\s*setView\(view === 'archives' \? 'archives' : 'chat'\);\s*closeSidebarOnMobile\(\)/);
});

test('removes duplicate companion IDs while normalizing settings', () => {
  const normalized = companions.normalizeCompanionSettings({
    activeId: 'companion-local-lina',
    companions: [
      { id: 'companion-local-lina', name: 'Lina', source: 'custom', spriteDataUrl: 'data:image/webp;base64,AAAA' },
      { id: 'companion-local-lina', name: 'Lina duplicate', source: 'custom', spriteDataUrl: 'data:image/webp;base64,BBBB' },
    ],
  });

  assert.equal(normalized.companions.filter(item => item.id === 'companion-local-lina').length, 1);
  assert.equal(normalized.companions[1].name, 'Lina');
  assert.equal(normalized.activeId, 'companion-local-lina');
});

test('keeps generation timers independent from time spent waiting in the queue', () => {
  const now = 100_000;

  assert.equal(generationTimer.getGenerationElapsedSeconds(0, now, now), 1);
  assert.equal(generationTimer.getGenerationElapsedSeconds(0, 97_000, now), 3);
  assert.equal(generationTimer.getGenerationElapsedSeconds(0, 99_000, now), 1);
  assert.equal(generationTimer.getGenerationElapsedSeconds(4, undefined, now), 4);
  assert.equal(generationTimer.getPreciseGenerationElapsedSeconds(0, 97_500, now), 2.5);
  assert.equal(generationTimer.getTrackedGenerationElapsedSeconds(0, undefined, 98_000, 1, now), 3);
  assert.equal(generationTimer.getTrackedGenerationElapsedSeconds(0, 97_500, 98_000, 1, now), 2.5);
  assert.equal(generationTimer.resolveGenerationStartedAt('processing', undefined, undefined, now), now);
  assert.equal(generationTimer.resolveGenerationStartedAt('processing', undefined, 98_000, now), 98_000);
  assert.equal(generationTimer.resolveGenerationStartedAt('processing', 95_000, 98_000, now), 98_000);
  assert.equal(generationTimer.resolveGenerationStartedAt('processing', 95_000, undefined, now, 4), 96_000);
  assert.equal(generationTimer.resolveGenerationStartedAt('pending', undefined, undefined, now), undefined);
});

test('applies an early processing update to the random temporary generation ID', () => {
  const acknowledged = [{
    id: 'temp-random-client-id',
    role: 'bot',
    text: '',
    timestamp: 1_000,
    status: 'pending',
  }];
  const updated = webSocketHelpers.applyQueueUpdateToMessages(acknowledged, {
    messageId: 'server-message-id',
    status: 'processing',
    duration: 1,
  }, 2_000, 'temp-random-client-id');

  assert.equal(updated[0].id, 'server-message-id');
  assert.equal(updated[0].status, 'processing');
  assert.equal(updated[0].generationStartedAt, 1_000);
});

test('moves through waiting, preparing, and processing before starting the timer', () => {
  const message = {
    id: 'temp-generation',
    role: 'bot',
    text: '',
    timestamp: 1_000,
    status: 'pending',
    isStarting: true,
  };
  const queued = webSocketHelpers.applyQueueUpdateToMessages([message], {
    messageId: message.id,
    status: 'pending',
    queueRemaining: 2,
  }, 1_500);
  const preparing = webSocketHelpers.applyQueueUpdateToMessages(queued, {
    messageId: message.id,
    status: 'preparing',
    queueRemaining: 1,
  }, 1_750);
  const processing = webSocketHelpers.applyQueueUpdateToMessages([message], {
    messageId: message.id,
    status: 'processing',
    duration: 3,
  }, 5_000);

  assert.equal(queued[0].status, 'pending');
  assert.equal(queued[0].isStarting, false);
  assert.equal(queued[0].generationStartedAt, undefined);
  assert.equal(preparing[0].status, 'preparing');
  assert.equal(preparing[0].isStarting, true);
  assert.equal(preparing[0].generationStartedAt, undefined);
  assert.equal(processing[0].status, 'processing');
  assert.equal(processing[0].isStarting, false);
  assert.equal(processing[0].generationStartedAt, 2_000);
});

test('estimates generation progress without reaching completion early', () => {
  assert.equal(generationTimer.getEstimatedGenerationProgress(1, undefined), undefined);
  assert.equal(generationTimer.getEstimatedGenerationProgress(1, 0), undefined);
  assert.equal(generationTimer.getEstimatedGenerationProgress(1, 100), 2);
  assert.equal(generationTimer.getEstimatedGenerationProgress(50, 100), 50);
  assert.equal(generationTimer.getEstimatedGenerationProgress(120, 100), 96);
});

test('allows one-shot AI enhancement without enabling the global toggle', () => {
  const base = {
    llmEnabled: false,
    hasProvider: true,
    isRegeneration: false,
    skipEnhancement: false,
  };

  assert.equal(promptEnhancement.shouldEnhancePrompt({ ...base, forceEnhancement: false }), false);
  assert.equal(promptEnhancement.shouldEnhancePrompt({ ...base, forceEnhancement: true }), true);
  assert.equal(promptEnhancement.shouldEnhancePrompt({ ...base, hasProvider: false, forceEnhancement: true }), false);
  assert.equal(promptEnhancement.shouldEnhancePrompt({ ...base, skipEnhancement: true, forceEnhancement: true }), false);
});

test('moves one-shot AI prompts into the thread and reflects while enhancement is pending', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const chatCss = readFileSync('src/components/chat/ChatInterface.css', 'utf8');

  const sendStart = appSource.indexOf('const onHandleSend = useCallback');
  const sendEnd = appSource.indexOf('const onHandleSendRef', sendStart);
  const sendSource = appSource.slice(sendStart, sendEnd);
  assert.ok(sendSource.indexOf("if (override === undefined) setInput('');") < sendSource.indexOf('await handleSend('));
  assert.match(chatSource, /const enhancePromptOnce = async[\s\S]*?setIsOneShotAiSubmitting\(true\)[\s\S]*?await handleSend\(undefined, false, false, true\)/);
  assert.match(chatSource, /isEnhancing \|\| isOneShotAiSubmitting \? 'ai-processing'/);
  assert.match(chatSource, /aria-busy=\{isEnhancing \|\| isOneShotAiSubmitting\}/);
  assert.match(chatCss, /\.input-box\.ai-processing\s*\{[\s\S]*?animation: ai-border-reflection/);
});

test('hides the source prompt after AI rewriting and keeps the rewritten result', () => {
  const generationSource = readFileSync('src/hooks/useGeneration.ts', 'utf8');
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');

  assert.match(generationSource, /m\.id === botMsgId[\s\S]*?text: finalPrompt[\s\S]*?generationPrompt: finalPrompt[\s\S]*?prompt: templatePrompt/);
  assert.match(chatSource, /const isRewrittenPromptSource = msg\.role === 'user'[\s\S]*?!nextMessage\.isEnhancing[\s\S]*?nextMessage\.generationPrompt\?\.trim\(\) !== \(nextMessage\.prompt \|\| msg\.text \|\| ''\)\.trim\(\)/);
  assert.match(chatSource, /if \(isRewrittenPromptSource\) return null/);
  assert.match(chatSource, /const shouldShowText = messageText && !isRedundant/);
});

test('edits the visible prompt while its generation is queued or already running', () => {
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const generationRouteSource = readFileSync('../backend/src/routes/generation.ts', 'utf8');

  assert.match(chatSource, /const beginPendingPromptEdit = useCallback[\s\S]*?\['pending', 'preparing', 'processing'\]\.includes\(targetMessage\.status \|\| ''\)[\s\S]*?setPendingPromptEditor/);
  assert.match(chatSource, /target\.kind === 'message' && beginPendingPromptEdit\(target\.messageId, text\)/);
  assert.match(chatSource, /!editablePendingMessage \|\| !beginPendingPromptEdit\(msg\.id, textToEdit\)/);
  assert.match(generationRouteSource, /const keepsRewrittenSourceHidden = Boolean[\s\S]*?pendingMessage\.generationPrompt\.trim\(\) !== pendingMessage\.prompt\.trim\(\)/);
  assert.match(generationRouteSource, /keepsRewrittenSourceHidden \? pendingMessage\.prompt : prompt/);
  assert.match(generationRouteSource, /DELETE FROM queue WHERE id = \? AND status = 'processing'[\s\S]*?INSERT INTO queue[\s\S]*?disconnectQueueTask\(pendingMessage\.queueId\)/);
  assert.match(generationRouteSource, /axios\.post\(`\$\{targetUrl\}\/interrupt`/);
});

test('opens a custom long-press menu for draft and message text', () => {
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const chatCss = readFileSync('src/components/chat/ChatInterface.css', 'utf8');
  const menuSource = chatSource.slice(
    chatSource.indexOf('{textContextMenu && ('),
    chatSource.indexOf('{showRetryAllConfirm && (')
  );

  assert.match(chatSource, /const TEXT_LONG_PRESS_MS = 550/);
  assert.match(chatSource, /onContextMenu=\{\(event\) => handleTextContextMenu\(event, \{ kind: 'draft', text: input \}\)\}/);
  assert.match(chatSource, /className="message-text-context-target"/);
  assert.match(menuSource, /copyTextContextTarget/);
  assert.match(menuSource, /selectTextContextTarget/);
  assert.match(menuSource, /editTextContextTarget/);
  assert.match(menuSource, /deleteTextContextTarget/);
  assert.doesNotMatch(menuSource, /share|partager/i);
  assert.match(chatSource, /handleEdit\(text\)/);
  assert.match(chatSource, /setInput\(''\)/);
  assert.match(chatSource, /setMessageToDelete\(target\.messageId\)/);
  assert.match(chatCss, /\.text-context-menu-item\.danger\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?color:\s*#ff5c67;/);
});

test('detects whether prompt text can be translated to the interface language', () => {
  assert.equal(textLanguage.detectTextLanguage('A young woman standing in warm light'), 'en');
  assert.equal(textLanguage.detectTextLanguage('Une jeune femme debout dans une lumière chaude'), 'fr');
  assert.equal(textLanguage.canTranslateText('A young woman standing in warm light', 'fr'), true);
  assert.equal(textLanguage.canTranslateText('Une jeune femme dans une lumière chaude', 'fr'), false);
  assert.equal(textLanguage.canTranslateText('Bonjour', 'fr'), false);
  assert.equal(textLanguage.canTranslateText('Fuji', 'fr'), true);
});

test('offers LLM translation in the text menu and a copyable result dialog', () => {
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const chatCss = readFileSync('src/components/chat/ChatInterface.css', 'utf8');

  assert.match(chatSource, /disabled=\{!params\.llmProviderId \|\| !canTranslateText\(textContextMenu\.target\.text, lang\)\}/);
  assert.match(chatSource, /fetch\(`\$\{API_BASE\}\/api\/llm\/translate-text`/);
  assert.match(chatSource, /className="translation-modal"/);
  assert.match(chatSource, /copyTranslatedText/);
  assert.match(chatSource, /closeTextTranslation/);
  assert.match(chatCss, /\.text-context-menu-item:disabled\s*\{[\s\S]*?opacity:\s*0\.38/);
  assert.match(chatCss, /\.translation-modal\s*\{[\s\S]*?width:\s*min\(620px, 100%\)/);
});

test('opens image actions from a long press in the message thread', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const chatSource = readFileSync('src/components/chat/ChatInterface.tsx', 'utf8');
  const chatCss = readFileSync('src/components/chat/ChatInterface.css', 'utf8');
  const imageClipboardSource = readFileSync('src/utils/imageClipboard.ts', 'utf8');
  const imageDownloadSource = readFileSync('src/utils/imageDownload.ts', 'utf8');
  const imageMenuSource = chatSource.slice(
    chatSource.indexOf('{chatImageContextMenu && ('),
    chatSource.indexOf('{showRetryAllConfirm && (')
  );

  assert.match(chatSource, /startChatImageLongPress/);
  assert.match(chatSource, /onContextMenu=\{\(event\) => handleChatImageContextMenu/);
  assert.match(chatSource, /suppressChatImageClickRef\.current = true/);
  assert.match(imageMenuSource, /copyChatImage/);
  assert.match(imageMenuSource, /downloadChatImage/);
  assert.match(imageMenuSource, /modifyChatImage/);
  assert.match(imageMenuSource, /deleteChatImage/);
  assert.match(imageMenuSource, /className="chat-image-context-menu-shell"[\s\S]*?className="lightbox-context-menu-close"[\s\S]*?setChatImageContextMenu\(null\)[\s\S]*?<XIcon size=\{20\}/);
  assert.doesNotMatch(imageMenuSource, /share|partager/i);
  assert.match(chatSource, /copyImageToClipboard\(getFullImageUrl\(url\)\)/);
  assert.match(chatSource, /downloadImageByMessageId\(messageId, `img-\$\{messageId\}\.webp`\)/);
  assert.match(imageDownloadSource, /\/api\/gallery\/download\/\$\{encodeURIComponent\(messageId\)\}/);
  assert.match(imageDownloadSource, /link\.download = filename/);
  assert.match(imageClipboardSource, /new ClipboardItem\(\{ 'image\/png': pngPromise \}\)/);
  assert.match(chatSource, /setMessageToDelete\(messageId\)/);
  assert.match(appSource, /const handleImageModify = useCallback[\s\S]*?setActiveLightbox\(\{ \.\.\.item, source: 'chat' \}\)/);
  assert.match(appSource, /setShowLightboxModify\(Boolean\(pendingModify\)\)/);
  assert.match(chatCss, /\.image-wrapper\s*\{[\s\S]*?-webkit-touch-callout:\s*none;[\s\S]*?user-select:\s*none;/);
  assert.match(chatCss, /\.chat-image-context-menu\s*\{[^}]*background:\s*rgba\(24, 24, 28, 0\.94\);[^}]*backdrop-filter:\s*blur\(16px\)/);
});

test('parses slash commands and their numeric values', () => {
  assert.equal(slashCommands.getSlashCommandQuery('/lu'), 'lu');
  assert.equal(slashCommands.getSlashCommandQuery('/luck beach'), undefined);
  assert.deepEqual(slashCommands.parseSlashCommand('/luck bikini beach'), {
    name: 'luck',
    argument: 'bikini beach',
  });
  assert.deepEqual(slashCommands.parseSeedCommand('42'), { seedMode: 'fixed', forcedSeed: '42' });
  assert.deepEqual(slashCommands.parseSeedCommand('random'), { seedMode: 'random', forcedSeed: '' });
  assert.equal(slashCommands.parseBoundedNumberCommand('12', 1, 50, true), 12);
  assert.equal(slashCommands.parseBoundedNumberCommand('12.5', 1, 50, true), undefined);
  assert.equal(slashCommands.parseBoundedNumberCommand('21', 0, 20), undefined);
});
