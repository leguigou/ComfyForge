declare const __APP_VERSION__: string;

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
