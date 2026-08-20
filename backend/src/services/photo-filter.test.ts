import { describe, expect, it } from 'vitest';
import {
  appendPhotoFilter,
  normalizePhotoFilter,
  readStoredPhotoFilter,
} from './photo-filter';

describe('photo filters', () => {
  it('adds a selected filter to one executable prompt without changing the base prompt', () => {
    const basePrompt = 'portrait in a park';
    const filter = normalizePhotoFilter({
      id: 'raw-candid',
      label: 'Brut et spontané',
      prompt: 'raw candid photograph, natural available light',
    });

    expect(basePrompt).toBe('portrait in a park');
    expect(appendPhotoFilter(basePrompt, filter)).toBe(
      'portrait in a park, raw candid photograph, natural available light',
    );
  });

  it('keeps no-filter generations unchanged and restores stored filter snapshots', () => {
    expect(appendPhotoFilter('portrait in a park', null)).toBe('portrait in a park');
    expect(readStoredPhotoFilter({
      photoFilterId: 'era-y2k',
      photoFilterLabel: 'Y2K / années 2000',
      photoFilterPrompt: 'early-2000s point-and-shoot snapshot',
    })).toEqual({
      id: 'era-y2k',
      label: 'Y2K / années 2000',
      prompt: 'early-2000s point-and-shoot snapshot',
    });
  });

  it('rejects incomplete filter metadata instead of partially altering a prompt', () => {
    expect(normalizePhotoFilter({ id: 'raw-candid', label: '', prompt: 'raw photo' })).toBeNull();
    expect(normalizePhotoFilter(null)).toBeNull();
  });
});
