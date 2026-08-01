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
