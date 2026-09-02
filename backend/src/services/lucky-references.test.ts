import { describe, expect, it } from 'vitest';
import {
  normalizeLuckyReferenceCount,
  promptSimilarity,
  referenceConnections,
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
  it('requires two references for a new draw but allows one anchored replacement', () => {
    expect(normalizeLuckyReferenceCount(1)).toBe(2);
    expect(normalizeLuckyReferenceCount(1, true)).toBe(1);
    expect(normalizeLuckyReferenceCount(20)).toBe(8);
    expect(normalizeLuckyReferenceCount(undefined)).toBe(6);
  });

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

  it('does not treat composition, pose, lighting, or generic nature as semantic coherence', () => {
    const forest = candidate('forest', 'woman standing in a forest with soft light', [
      ['women', 'subject'], ['nature', 'setting'], ['standing', 'pose'], ['soft-light', 'lighting'], ['shallow-focus', 'shot']
    ]);
    const apartment = candidate('apartment', 'woman standing in an apartment with soft light', [
      ['women', 'subject'], ['nature', 'setting'], ['standing', 'pose'], ['soft-light', 'lighting'], ['shallow-focus', 'shot']
    ]);

    expect(shareMeaningfulTag(forest, apartment)).toBe(false);
  });

  it('rejects near-duplicate prompts and keeps references linked by meaningful tags', () => {
    const references = [
      candidate('a', 'woman in a red bikini on a sunny beach at sunset', [['women', 'subject'], ['swimwear', 'content'], ['beach', 'setting']]),
      candidate('duplicate', 'young woman in a red bikini on the sunny beach at sunset', [['women', 'subject'], ['swimwear', 'content'], ['beach', 'setting']]),
      candidate('b', 'blonde model wearing blue swimwear beside ocean waves', [['women', 'subject'], ['swimwear', 'content'], ['beach', 'setting']]),
      candidate('d', 'surfer in a green swimsuit walking beside a rocky coast', [['women', 'subject'], ['swimwear', 'content'], ['beach', 'setting']]),
      candidate('c', 'fashion portrait in a city street at night', [['women', 'subject'], ['street', 'setting'], ['neon', 'lighting']]),
    ];

    expect(promptSimilarity(references[0].prompt, references[1].prompt)).toBeGreaterThanOrEqual(0.72);
    const selected = selectLuckyReferences(references, 3, { random: () => 0.5, now: 100_000 });
    expect(selected.map(item => item.messageId)).toContain('b');
    expect(selected.map(item => item.messageId)).toContain('d');
    expect(selected.map(item => item.messageId)).not.toContain('duplicate');
    expect(selected.map(item => item.messageId)).not.toContain('c');
  });

  it('rejects a tag chain when the endpoints have no direct semantic link', () => {
    const references = [
      candidate('a', 'red swimsuit on a beach', [['beach', 'setting']]),
      candidate('b', 'freckled swimmer by the shore', [['beach', 'setting'], ['freckles', 'detail']]),
      candidate('c', 'freckled model with tattoos', [['freckles', 'detail'], ['tattoos', 'detail']]),
      candidate('d', 'tattoo portrait in a studio', [['tattoos', 'detail'], ['studio', 'setting']]),
    ];

    expect(selectLuckyReferences(references, 4, {
      random: () => 0.5,
      now: 100_000,
    })).toEqual([]);
  });

  it('gives every selected reference a direct connection to all the others', () => {
    const references = [
      candidate('a', 'swimwear portrait on white sand', [['swimwear', 'content'], ['beach', 'setting']]),
      candidate('b', 'surfer beside ocean waves', [['swimwear', 'content'], ['beach', 'setting']]),
      candidate('c', 'colorful swimsuit on a rocky coast', [['swimwear', 'content'], ['beach', 'setting']]),
    ];
    const selected = selectLuckyReferences(references, 3, { random: () => 0.5, now: 100_000 });

    expect(selected).toHaveLength(3);
    selected.forEach(reference => {
      expect(referenceConnections(reference, selected)).toHaveLength(2);
    });
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
