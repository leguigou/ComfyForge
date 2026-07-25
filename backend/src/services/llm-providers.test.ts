import { describe, expect, it } from 'vitest';
import { configureProviderEncryption, decryptApiKey, encryptApiKey, PROVIDER_PRESETS } from './llm-providers';

describe('LLM provider configuration', () => {
  it('encrypts API keys with authenticated encryption', () => {
    configureProviderEncryption('test-secret-with-at-least-32-characters');
    const encrypted = encryptApiKey('sk-sensitive-value');

    expect(encrypted).not.toContain('sk-sensitive-value');
    expect(decryptApiKey(encrypted)).toBe('sk-sensitive-value');
  });

  it('offers the main provider families and a local provider', () => {
    expect(PROVIDER_PRESETS.some(provider => provider.id === 'openai')).toBe(true);
    expect(PROVIDER_PRESETS.some(provider => provider.type === 'anthropic')).toBe(true);
    expect(PROVIDER_PRESETS.some(provider => provider.type === 'google')).toBe(true);
    expect(PROVIDER_PRESETS.find(provider => provider.id === 'ollama')?.requiresApiKey).toBe(false);
  });
});
