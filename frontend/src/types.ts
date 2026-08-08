export interface Message {
  id: string;
  role: 'user' | 'bot';
  text: string;
  prompt?: string;
  generationPrompt?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  model?: string;
  workflow?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  sampler?: string;
  scheduler?: string;
  timestamp: number;
  status?: 'pending' | 'preparing' | 'processing' | 'completed' | 'failed';
  isEnhancing?: boolean;
  isStarting?: boolean;
  duration?: number;
  generationStartedAt?: number;
  isFavorite?: number;
  isPromptFavorite?: number;
  tags?: PromptTag[];
  randomSelections?: RandomPromptSelection[];
  comparisonMessageId?: string;
}

export interface GalleryItem {
  sessionId: string;
  messageId: string;
  imageUrl: string;
  thumbnailUrl?: string;
  prompt: string;
  text?: string;
  generationPrompt?: string;
  timestamp: number;
  model?: string;
  workflow?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  sampler?: string;
  scheduler?: string;
  duration?: number;
  isFavorite?: number;
  isPromptFavorite?: number;
  tags?: PromptTag[];
  randomSelections?: RandomPromptSelection[];
  comparisonMessageId?: string;
}

export interface PromptTag {
  slug: string;
  category: string;
  labelFr: string;
  labelEn: string;
  count?: number;
}

export interface NodeMapping {
  checkpoint: string;
  positive: string;
  negative: string;
  ksampler: string;
  latent: string;
  save: string;
}

export interface FavoriteModel {
  model: string;
  workflowFile: string;
  modelType?: 'checkpoint' | 'diffusion';
  generationDefaults?: Partial<ModelGenerationDefaults>;
}

export interface ComfyModelDetails {
  name: string;
  sizeBytes?: number;
  sizeGb?: number;
}

export interface ModelGenerationDefaults {
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

export interface RandomPromptList {
  id: string;
  name: string;
  slug: string;
  values: string[];
  enabled: boolean;
}

export interface RandomPromptSelection {
  listId: string;
  name: string;
  slug: string;
  value: string;
}

export interface CompanionProfile {
  id: string;
  name: string;
  source: 'builtin' | 'custom';
  spriteUrl?: string;
  spriteDataUrl?: string;
  spriteMimeType?: 'image/png' | 'image/webp';
  spriteBytes?: number;
  fileName?: string;
}

export interface CompanionSettings {
  enabled: boolean;
  activeId: string;
  companions: CompanionProfile[];
}

export interface GenParameters {
  onboardingCompleted?: boolean;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler?: string;
  scheduler?: string;
  comfyUrl: string;
  comfyModel: string;
  comfyModelType: 'checkpoint' | 'diffusion';
  llmUrl: string;
  llmModel: string;
  llmSystemMessage: string;
  negativePrompt: string;
  llmEnabled: boolean;
  clipboardAutoGenerate: boolean;
  llmProviderId?: string;
  visionProviderId?: string;
  visionModel?: string;
  visionSystemMessage: string;
  visionDetailLevel: number;
  visionModelTtlMinutes: number;
  luckyTemperature: number;
  luckyFavoriteCount: number;
  workflowFile: string;
  nodeMapping: NodeMapping;
  seedMode: 'random' | 'fixed';
  forcedSeed?: string;
  favoriteModels: FavoriteModel[];
  randomPromptLists: RandomPromptList[];
  randomPromptListsVersion?: number;
  companionSettings: CompanionSettings;
}

export interface LLMProvider {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'google';
  baseUrl: string;
  model: string;
  isActive: boolean;
  hasApiKey: boolean;
  apiKeyPreview?: string | null;
}

export interface LuckyReference {
  messageId: string;
  prompt: string;
  imageUrl: string;
  thumbnailUrl?: string | null;
  isFavorite?: number;
  tags: PromptTag[];
  matchingTags: PromptTag[];
}

export interface Session {
  id: string;
  title: string;
  updatedAt: number;
  isArchived?: number;
  generationStatus?: 'idle' | 'processing' | 'unseen';
}

export type Theme = 'light' | 'dark';
export type Language = 'fr' | 'en';
export type AppView = 'chat' | 'gallery' | 'archives' | 'statistics' | 'comparison';

export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  avatarUrl?: string | null;
  createdAt?: number;
  imageCount?: number;
  diskUsage?: number;
  queueLimit?: number | null;
  activeQueueCount?: number;
}
