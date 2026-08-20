import { describe, expect, it } from 'vitest';
import {
  groupItemsByPrompt,
  groupItemsByPromptAsync,
  normalizePromptText,
  promptSimilarityPercent,
} from './prompt-grouping';

const item = (messageId: string, generationPrompt: string, timestamp: number) => ({
  messageId,
  generationPrompt,
  timestamp,
});

describe('prompt grouping', () => {
  it('ignores case, punctuation, and repeated whitespace for every prompt length', () => {
    expect(normalizePromptText('  Portrait, ROUGE...  lumière\n douce! '))
      .toBe('portrait rouge lumière douce');
    const groups = groupItemsByPrompt([
      item('old', 'Portrait, rouge... lumière douce!', 1),
      item('new', ' portrait rouge lumière   douce ', 2),
    ], { minWords: 20, similarity: 90 });
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map(entry => entry.messageId)).toEqual(['new', 'old']);
  });

  it('groups long prompts at the configured word similarity threshold', () => {
    const original = 'one two three four five six seven eight nine ten';
    const changed = 'one two three four five six seven eight nine portrait';
    expect(promptSimilarityPercent(original, changed)).toBe(90);
    expect(groupItemsByPrompt([
      item('a', original, 1),
      item('b', changed, 2),
    ], { minWords: 10, similarity: 90 })).toHaveLength(1);
    expect(groupItemsByPrompt([
      item('a', original, 1),
      item('b', changed, 2),
    ], { minWords: 10, similarity: 91 })).toHaveLength(2);
  });

  it('does not approximate prompts below the configured minimum length', () => {
    expect(groupItemsByPrompt([
      item('a', 'one two three four five', 1),
      item('b', 'one two three four portrait', 2),
    ], { minWords: 6, similarity: 80 })).toHaveLength(2);
  });

  it('reports cooperative progress while preserving manual groups', async () => {
    const progress: Array<{ processed: number; total: number; groups: number }> = [];
    const items = Array.from({ length: 24 }, (_, index) => ({
      ...item(`progress-${index}`, `portrait number ${index}`, index),
      manualGroupId: index < 2 ? 'manual-progress-group' : null,
    }));
    const groups = await groupItemsByPromptAsync(
      items,
      { minWords: 20, similarity: 90 },
      update => progress.push({ ...update }),
      5,
    );

    expect(progress.length).toBeGreaterThan(2);
    expect(progress.at(-1)).toMatchObject({ processed: 24, total: 24 });
    expect(groups.find(group => group.items.some(entry => entry.manualGroupId === 'manual-progress-group'))?.items)
      .toHaveLength(2);
  });
});
