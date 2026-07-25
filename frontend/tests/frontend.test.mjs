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
let config;

before(async () => {
  vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  });

  api = await vite.ssrLoadModule('/src/services/api.ts');
  config = await vite.ssrLoadModule('/src/config.ts');
  randomPrompts = await vite.ssrLoadModule('/src/utils/randomPrompts.ts');
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
