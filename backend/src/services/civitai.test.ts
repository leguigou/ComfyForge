import { describe, expect, it } from 'vitest';
import { normalizeModelName } from './civitai';

describe('Civitai model matching', () => {
  it('normalizes local model paths and Civitai filenames consistently', () => {
    expect(normalizeModelName('folder\\intorealism_zitV70.safetensors')).toBe('intorealismzitv70');
    expect(normalizeModelName('IntoRealism ZIT v7.0')).toBe('intorealismzitv70');
  });
});
