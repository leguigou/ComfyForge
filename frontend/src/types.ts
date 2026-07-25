export interface Message {
  id: string;
  role: 'user' | 'bot';
  text: string;
  prompt?: string;
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
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  isEnhancing?: boolean;
  duration?: number;
  generationStartedAt?: number;
  isFavorite?: number;
  randomSelections?: RandomPromptSelection[];
}

export interface GalleryItem {
  sessionId: string;
  messageId: string;
  imageUrl: string;
  thumbnailUrl?: string;
  prompt: string;
  text?: string;
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
  randomSelections?: RandomPromptSelection[];
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

export interface GenParameters {
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
  llmProviderId?: string;
  workflowFile: string;
  nodeMapping: NodeMapping;
  seedMode: 'random' | 'fixed';
  forcedSeed?: string;
  favoriteModels: FavoriteModel[];
  randomPromptLists: RandomPromptList[];
  randomPromptListsVersion?: number;
}

export interface LLMProvider {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'google';
  baseUrl: string;
  model: string;
  isActive: boolean;
  hasApiKey: boolean;
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

export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  avatarUrl?: string;
  imageCount?: number;
  diskUsage?: number;
}
