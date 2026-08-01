import { describe, expect, it } from 'vitest';
import {
  promptSimilarity,
  selectLuckyReferences,
  shareMeaningfulTag,
  type LuckyReferenceCandidate
} from './lucky-references';

const candidate = (
  messageId: string,
  prompt: string,
  tags: Array<[string, string]>
): LuckyReferenceCandidate => ({
  messageId,
  prompt,
  imageUrl: `${messageId}.webp`,
  timestamp: 1,
  tags: tags.map(([slug, category]) => ({ slug, category, labelFr: slug, labelEn: slug }))
});

describe('lucky reference selection', () => {
  it('ignores generic subject tags when checking coherence', () => {
    const beach = candidate('beach', 'woman on a beach', [['women', 'subject'], ['beach', 'setting']]);
    const street = candidate('street', 'woman in a street', [['women', 'subject'], ['street', 'setting']]);
    const bikini = candidate('bikini', 'woman in bikini by the ocean', [['women', 'subject'], ['beach', 'setting']]);

    expect(shareMeaningfulTag(beach, street)).toBe(false);
    expect(shareMeaningfulTag(beach, bikini)).toBe(true);
  });

  it('does not use a generic photorealistic style as the common point', () => {
    const beach = candidate('beach', 'woman on a beach', [['women', 'subject'], ['photorealistic', 'style']]);
    const studio = candidate('studio', 'man inside a studio', [['men', 'subject'], ['photorealistic', 'style']]);

    expect(shareMeaningfulTag(beach, studio)).toBe(false);
  });

  it('rejects near-duplicate prompts and keeps references linked by meaningful tags', () => {
    const references = [
      candidate('a', 'woman in a red bikini on a sunny beach at sunset', [['women', 'subject'], ['swimwear', 'content'], ['beach', 'setting']]),
      candidate('duplicate', 'young woman in a red bikini on the sunny beach at sunset', [['women', 'subject'], ['swimwear', 'content'], ['beach', 'setting']]),
      candidate('b', 'blonde model wearing blue swimwear beside ocean waves', [['women', 'subject'], ['swimwear', 'content'], ['beach', 'setting']]),
      candidate('c', 'fashion portrait in a city street at night', [['women', 'subject'], ['street', 'setting'], ['neon', 'lighting']]),
    ];

    expect(promptSimilarity(references[0].prompt, references[1].prompt)).toBeGreaterThanOrEqual(0.72);
    const selected = selectLuckyReferences(references, 3, { random: () => 0.5, now: 100_000 });
    expect(selected.map(item => item.messageId)).toContain('b');
    expect(selected.map(item => item.messageId)).not.toContain('duplicate');
    expect(selected.map(item => item.messageId)).not.toContain('c');
  });

  it('finds an individual replacement coherent with preserved anchors', () => {
    const anchor = candidate('anchor', 'bikini on the beach', [['beach', 'setting']]);
    const replacement = candidate('replacement', 'ocean portrait', [['beach', 'setting']]);
    const unrelated = candidate('unrelated', 'city portrait', [['street', 'setting']]);

    expect(selectLuckyReferences([replacement, unrelated], 1, {
      anchors: [anchor],
      random: () => 0.5,
      now: 100_000
    })).toEqual([replacement]);
  });
});
