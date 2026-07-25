export interface User {
  id: string;
  username: string;
  password: string;
  isAdmin: number; // SQLite uses 0/1
  avatarUrl: string | null;
  storageLimit: number | null;
  createdAt: number;
}

export interface SanitizedUser {
  username: string;
  isAdmin: boolean;
  avatarUrl: string | null;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'bot';
  text: string;
  prompt: string;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  timestamp: number;
  model: string | null;
  width: number | null;
  height: number | null;
  steps: number | null;
  cfg: number | null;
  workflow: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  seed: number | null;
  duration: number | null;
  sampler: string | null;
  scheduler: string | null;
  randomSelections: string | null;
  generationPrompt: string | null;
  generationParams: string | null;
}

export interface Session {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface QueueTask {
  id: number;
  messageId: string;
  prompt: string;
  originalPrompt: string;
  sessionId: string;
  params: string; // JSON string
  status: 'pending' | 'processing';
  createdAt: number;
}

export interface GenerationParams {
  comfyModel?: string;
  comfyModelType?: 'checkpoint' | 'diffusion';
  comfyUrl?: string;
  workflowFile?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  sampler?: string;
  scheduler?: string;
  negativePrompt?: string;
  nodeMapping?: WorkflowNodeMapping;
}

export interface WorkflowNodeMapping {
  checkpoint?: string;
  diffusionModel?: string;
  positive?: string;
  negative?: string;
  ksampler?: string;
  latent?: string;
  save?: string;
}

export interface WorkflowConfig {
  nodeMapping?: WorkflowNodeMapping;
}

export interface ComfyHistoryImage {
  filename: string;
  subfolder: string;
  type: string;
}

export interface ComfyHistoryOutputs {
  [nodeId: string]: {
    images?: ComfyHistoryImage[];
  };
}

export interface ComfyHistoryStatus {
  status_str?: string;
  completed?: boolean;
  messages?: Array<[string, { message: string }]>;
}

export interface ComfyHistoryEntry {
  outputs?: ComfyHistoryOutputs;
  status?: ComfyHistoryStatus;
}

export interface CookieOptions {
  httpOnly: boolean;
  signed: boolean;
  maxAge?: number;
  path?: string;
  sameSite: 'lax' | 'none' | 'strict';
  secure?: boolean;
  domain?: string;
}
