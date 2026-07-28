import { describe, expect, it } from 'vitest';
import { classifyPrompt } from './prompt-tags';

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
});
