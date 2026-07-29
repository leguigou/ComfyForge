declare const __APP_VERSION__: string;

export const DEFAULT_LLM_SYSTEM_MESSAGE = "You are a professional stable diffusion prompt engineer. Transform the user's brief idea into a highly detailed, descriptive, and artistic prompt in ENGLISH. Also generate a negative prompt of things to avoid. Output your response as a JSON object with two keys: 'positive' and 'negative'. No other text.";

/**
 * Global application configuration.
 * Centralizing this ensures a single source of truth for metadata and constants.
 */
export const APP_CONFIG = {
  VERSION: __APP_VERSION__,
  GITHUB_REPO: 'leguigou/ComfyForge',
  API_ENDPOINTS: {
    CHECK_UPDATE: '/api/updates/check',
    SETTINGS: '/api/settings',
    USERS: '/api/users',
    AUTH_CHECK: '/api/auth/check'
  }
} as const;
