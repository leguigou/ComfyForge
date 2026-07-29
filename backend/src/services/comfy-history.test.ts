import { describe, expect, it } from 'vitest';
import { resolveComfyHistoryImage } from './comfy-history';

describe('resolveComfyHistoryImage', () => {
  it('uses the configured output node when it contains an image', () => {
    const image = resolveComfyHistoryImage({
      outputs: {
        '52': { images: [{ filename: 'preview.png', subfolder: '', type: 'temp' }] },
        '99': { images: [{ filename: 'saved.png', subfolder: 'final', type: 'output' }] }
      }
    }, '99');

    expect(image).toEqual({
      nodeId: '99',
      filename: 'saved.png',
      subfolder: 'final',
      type: 'output'
    });
  });

  it('falls back to a PreviewImage node when the configured node is stale', () => {
    const image = resolveComfyHistoryImage({
      outputs: {
        '52': { images: [{ filename: 'preview.png', subfolder: '', type: 'temp' }] }
      }
    }, '99');

    expect(image).toEqual({
      nodeId: '52',
      filename: 'preview.png',
      subfolder: '',
      type: 'temp'
    });
  });

  it('prefers a persistent output when no configured node matches', () => {
    const image = resolveComfyHistoryImage({
      outputs: {
        '10': { images: [{ filename: 'preview.png', subfolder: '', type: 'temp' }] },
        '20': { images: [{ filename: 'saved.png', subfolder: '', type: 'output' }] }
      }
    }, '99');

    expect(image?.filename).toBe('saved.png');
  });
});
