import { describe, it, expect } from 'vitest';
import { parseComfyError } from './comfy';

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
