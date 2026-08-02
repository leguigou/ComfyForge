import axios from 'axios';
import { describe, it, expect, vi } from 'vitest';
import { isComfyConnectionRefused, parseComfyError, releaseComfyMemory } from './comfy';

describe('releaseComfyMemory', () => {
  it('requests model unloading and cache release from ComfyUI', async () => {
    const post = vi.fn().mockResolvedValueOnce({ data: {} });
    const createSpy = vi.spyOn(axios, 'create').mockReturnValueOnce({ post } as any);

    await releaseComfyMemory('http://127.0.0.1:8188');

    expect(createSpy).toHaveBeenCalledWith({
      baseURL: 'http://127.0.0.1:8188',
      timeout: 30000,
    });
    expect(post).toHaveBeenCalledWith('/free', {
      unload_models: true,
      free_memory: true,
    });
    createSpy.mockRestore();
  });

  it('rejects an unlisted origin before creating the HTTP client', async () => {
    const createSpy = vi.spyOn(axios, 'create');

    await expect(releaseComfyMemory('https://unlisted.example.test')).rejects.toThrow(
      'ComfyUI origin is not allowed'
    );

    expect(createSpy).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });
});

describe('parseComfyError', () => {
  it('returns a user-friendly message for ECONNREFUSED', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8188');
    expect(parseComfyError(err)).toBe('ComfyUI is unreachable. Please check settings.');
  });

  it('returns a timeout message for ETIMEDOUT code', () => {
    const err = { code: 'ETIMEDOUT', message: 'timeout of 5000ms exceeded' };
    expect(parseComfyError(err)).toBe('ComfyUI request timed out (possible GPU overload or hang).');
  });

  it('returns a timeout message for timeout keyword in message', () => {
    const err = new Error('socket timeout');
    expect(parseComfyError(err)).toBe('ComfyUI request timed out (possible GPU overload or hang).');
  });

  it('extracts error message from ComfyUI API response', () => {
    const err = {
      response: {
        data: {
          error: {
            message: 'Connection error from ComfyUI prompt',
          },
        },
      },
    };
    expect(parseComfyError(err)).toBe('Connection error from ComfyUI prompt');
  });

  it('includes error details if present', () => {
    const err = {
      response: {
        data: {
          error: {
            message: 'Queue full',
            details: 'max 10 items',
          },
        },
      },
    };
    expect(parseComfyError(err)).toBe('Queue full (max 10 items)');
  });

  it('extracts node-level errors from ComfyUI', () => {
    const err = {
      response: {
        data: {
          node_errors: {
            '3': {
              class_type: 'CLIPTextEncode',
              errors: [{ message: 'Prompt too long', details: 'over 256 tokens' }],
            },
          },
        },
      },
    };
    expect(parseComfyError(err)).toBe('Node 3 (CLIPTextEncode): Prompt too long - over 256 tokens');
  });

  it('returns the raw message for unknown errors', () => {
    const err = new Error('Something went wrong');
    expect(parseComfyError(err)).toBe('Something went wrong');
  });

  it('returns fallback for empty error', () => {
    expect(parseComfyError({})).toBe('Unknown server error');
  });
});

describe('isComfyConnectionRefused', () => {
  it('detects connection refusal from the Axios error code', () => {
    expect(isComfyConnectionRefused({ code: 'ECONNREFUSED' })).toBe(true);
  });

  it('detects a nested connection refusal', () => {
    expect(isComfyConnectionRefused({ cause: new Error('connect ECONNREFUSED 127.0.0.1:8188') })).toBe(true);
  });

  it('does not classify timeouts or HTTP errors as connection refusal', () => {
    expect(isComfyConnectionRefused({ code: 'ETIMEDOUT', message: 'timeout' })).toBe(false);
    expect(isComfyConnectionRefused({ response: { status: 500 } })).toBe(false);
  });
});
