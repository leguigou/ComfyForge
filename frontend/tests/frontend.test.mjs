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

test('renders the localized welcome screen', () => {
  const french = renderToStaticMarkup(React.createElement(WelcomeScreen, { lang: 'fr' }));
  const english = renderToStaticMarkup(React.createElement(WelcomeScreen, { lang: 'en' }));

  assert.match(french, /Que souhaitez-vous créer/);
  assert.match(english, /What would you like to create/);
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

test('loads confirmation dialog styles without opening settings', () => {
  const appCss = readFileSync('src/App.css', 'utf8');
  assert.match(appCss, /\.settings-modal-overlay\s*\{/);
  assert.match(appCss, /\.confirm-modal\s*\{/);
  assert.match(appCss, /\.confirm-btn\.delete\s*\{/);
});

test('shows the generation counter from two remaining through the final generation', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');

  assert.match(appSource, /if \(queueRemaining >= 2\)/);
  assert.match(appSource, /else if \(queueRemaining <= 0\)/);
  assert.match(appSource, /showQueueIndicator && \(queueRemaining \?\? 0\) >= 1/);
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

  assert.match(appSource, /const handleLightboxWheel = useCallback/);
  assert.match(appSource, /Math\.exp\(-e\.deltaY \* 0\.0015\)/);
  assert.match(appSource, /Math\.min\(4, Math\.max\(1, zoomScale \* factor\)\)/);
  assert.match(appSource, /onWheel=\{handleLightboxWheel\}/);
  assert.match(appSource, /className="lightbox-btn go-to-chat"[\s\S]*?goToImage\(activeLightbox\.sessionId, activeLightbox\.messageId\)/);
  assert.match(appSource, /onTouchStart=\{handleLightboxTouchStart\}[\s\S]*?onTouchMove=\{handleLightboxTouchMove\}/);
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
