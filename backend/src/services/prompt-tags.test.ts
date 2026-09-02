import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  classifyPrompt,
  PROMPT_TAG_INDEX_VERSION,
  repairMissingPromptTags,
  syncPromptTagDefinitions,
} from './prompt-tags';

const slugsFor = (prompt: string) => classifyPrompt(prompt).map(tag => tag.slug);

describe('classifyPrompt', () => {
  it('keeps the subject and exact group size among the important tags', () => {
    const tags = slugsFor(
      'A group photo of three 18-year-old young girls at a sunny beach, '
      + 'topless, with soft shadows, bokeh and a photorealistic style.'
    );

    expect(tags).toContain('women');
    expect(tags).toContain('three-people');
    expect(tags).toContain('beach');
  });

  it('distinguishes a pair from a larger generic group', () => {
    const tags = slugsFor('Two young women standing together in a city street for a group photo.');

    expect(tags).toContain('women');
    expect(tags).toContain('two-people');
    expect(tags).not.toContain('group');
  });

  it('infers nudity and sexual activity from explicit stimulation', () => {
    const tags = slugsFor(
      'A voyeur photo of an 18 year old blonde woman standing in a shower, taking a shower. '
      + 'The woman has an electric toothbrush against her clitoris, between her thighs and '
      + 'is moaning in pleasure as she holds the toothbrush.'
    );

    expect(tags).toEqual(expect.arrayContaining([
      'women',
      'blonde',
      'bathroom',
      'voyeur',
      'genitals',
      'explicit',
      'sexual-activity',
      'nudity',
    ]));
  });

  it.each([
    ['large breasts and deep cleavage', 'large-breasts'],
    ['medium sized breasts', 'medium-breasts'],
    ['small breasts', 'small-breasts'],
  ])('adds the generic breast tag and its size for %s', (prompt, sizeTag) => {
    const tags = slugsFor(`A woman with ${prompt}.`);

    expect(tags).toContain('breasts');
    expect(tags).toContain(sizeTag);
  });

  it('does not add breast or nudity tags when they are explicitly negated', () => {
    const tags = slugsFor('A woman without visible breasts, no nudity, wearing a winter coat.');

    expect(tags).not.toContain('breasts');
    expect(tags).not.toContain('nudity');
  });

  it('recognizes terse Stable Diffusion syntax and recurring French prompts', () => {
    expect(slugsFor('1girl, orange hair, post-apocalypse')).toContain('women');
    expect(slugsFor('Un jeune couple en train de faire du sexe dans un lit')).toEqual(
      expect.arrayContaining(['two-people', 'sexual-activity', 'nudity', 'bedroom'])
    );
    expect(slugsFor('Superbe paysage à la montagne')).toEqual(
      expect.arrayContaining(['landscape', 'mountain'])
    );
  });
});

describe('incremental prompt tag indexing', () => {
  it('preserves existing tags and repairs each missing image only once', async () => {
    const database = new Database(':memory:');
    database.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, role TEXT NOT NULL, generationPrompt TEXT,
        prompt TEXT, text TEXT, imageUrl TEXT, timestamp INTEGER NOT NULL
      );
      CREATE TABLE tags (
        id TEXT PRIMARY KEY, category TEXT NOT NULL, labelFr TEXT NOT NULL, labelEn TEXT NOT NULL
      );
      CREATE TABLE message_tags (
        messageId TEXT NOT NULL, tagId TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'auto',
        confidence REAL NOT NULL DEFAULT 1, PRIMARY KEY (messageId, tagId)
      );
      CREATE TABLE message_tag_index_state (
        messageId TEXT PRIMARY KEY, version INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
    `);
    syncPromptTagDefinitions(database);
    const insert = database.prepare(`
      INSERT INTO messages (id, role, prompt, imageUrl, timestamp)
      VALUES (?, 'bot', ?, ?, ?)
    `);
    insert.run('already-tagged', 'woman portrait', '/tagged.webp', 1);
    database.prepare(`
      INSERT INTO message_tags (messageId, tagId, source) VALUES ('already-tagged', 'women', 'auto')
    `).run();

    const first = await repairMissingPromptTags(database, 10);
    expect(first.processed).toBe(0);
    expect(database.prepare(`SELECT tagId FROM message_tags WHERE messageId = 'already-tagged'`).all())
      .toEqual([{ tagId: 'women' }]);

    insert.run('missing-tags', 'woman standing on a beach', '/missing.webp', 2);
    insert.run('no-match', 'xyzzq', '/no-match.webp', 3);
    const repaired = await repairMissingPromptTags(database, 1);
    expect(repaired.processed).toBe(2);
    expect(database.prepare(`
      SELECT version FROM message_tag_index_state WHERE messageId = 'no-match'
    `).get()).toEqual({ version: PROMPT_TAG_INDEX_VERSION });
    expect(database.prepare(`SELECT tagId FROM message_tags WHERE messageId = 'missing-tags'`).all())
      .toEqual(expect.arrayContaining([{ tagId: 'women' }, { tagId: 'beach' }]));

    const secondPass = await repairMissingPromptTags(database, 10);
    expect(secondPass.processed).toBe(0);
    database.close();
  });
});
