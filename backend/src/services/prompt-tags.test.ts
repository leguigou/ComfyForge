import { describe, expect, it } from 'vitest';
import { classifyPrompt } from './prompt-tags';

const slugs = (prompt: string) => classifyPrompt(prompt).map(tag => tag.slug);

describe('prompt tag classifier', () => {
  it('extracts a small set of meaningful concepts', () => {
    expect(slugs('A blonde woman in a bikini on a sandy beach, candid smartphone photograph with natural daylight'))
      .toEqual(expect.arrayContaining(['blonde', 'swimwear', 'beach', 'candid', 'natural-light']));
  });

  it('does not tag negated concepts', () => {
    const result = slugs('Portrait indoors without a bikini, no nudity, with soft shadows');
    expect(result).not.toEqual(expect.arrayContaining(['swimwear', 'nudity']));
    expect(result).toContain('soft-light');
  });

  it('limits the number of automatic tags', () => {
    expect(classifyPrompt('Blonde woman standing in a bedroom, bikini, selfie, shallow depth of field, bokeh, soft light, cinematic').length)
      .toBeLessThanOrEqual(6);
  });
});
