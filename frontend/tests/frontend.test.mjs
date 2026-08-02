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
let randomPrompts;
let companions;
let generationTimer;
let promptEnhancement;
let slashCommands;
let config;
let webSocketHelpers;

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
  promptEnhancement = await vite.ssrLoadModule('/src/utils/promptEnhancement.ts');
  slashCommands = await vite.ssrLoadModule('/src/utils/slashCommands.ts');
  webSocketHelpers = await vite.ssrLoadModule('/src/hooks/useWebSocket.ts');
  ({ WelcomeScreen } = await vite.ssrLoadModule('/src/components/chat/WelcomeScreen.tsx'));
  ({ MessageText } = await vite.ssrLoadModule('/src/components/chat/MessageText.tsx'));
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
      { id: 'custom-one', name: 'Pixel', source: 'custom', spriteDataUrl: 'data:image/webp;base64,AAAA' },
    ],
  });

  assert.equal(customized.enabled, false);
  assert.equal(customized.companions[0].name, 'Pousse');
  assert.equal(customized.activeId, 'custom-one');
  assert.equal(customized.companions[1].name, 'Pixel');
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

test('keeps a counter-free starting state until processing is confirmed', () => {
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
  const processing = webSocketHelpers.applyQueueUpdateToMessages([message], {
    messageId: message.id,
    status: 'processing',
    duration: 3,
  }, 5_000);

  assert.equal(queued[0].status, 'pending');
  assert.equal(queued[0].isStarting, false);
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
