import { describe, expect, it } from 'vitest';
import { configureProviderEncryption, decryptApiKey, detectLocalProviderEngine, encryptApiKey, PROVIDER_PRESETS } from './llm-providers';

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
    expect(PROVIDER_PRESETS.find(provider => provider.id === 'lmstudio')?.requiresApiKey).toBe(false);
  });

  it('recognizes supported local memory engines without treating cloud providers as local', () => {
    expect(detectLocalProviderEngine({
      name: 'My Ollama',
      type: 'openai',
      baseUrl: 'http://127.0.0.1:11434',
    })).toBe('ollama');
    expect(detectLocalProviderEngine({
      name: 'LM Studio',
      type: 'openai',
      baseUrl: 'http://localhost:1234/v1',
    })).toBe('lmstudio');
    expect(detectLocalProviderEngine({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
    })).toBeNull();
  });
});
