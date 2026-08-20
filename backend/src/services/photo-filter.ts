export interface StoredPhotoFilter {
  id: string;
  label: string;
  prompt: string;
}

const MAX_FILTER_ID_LENGTH = 80;
const MAX_FILTER_LABEL_LENGTH = 120;
const MAX_FILTER_PROMPT_LENGTH = 2_000;

const normalizeText = (value: unknown, maxLength: number) => (
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : ''
);

export const normalizePhotoFilter = (value: unknown): StoredPhotoFilter | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const id = normalizeText(source.id, MAX_FILTER_ID_LENGTH);
  const label = normalizeText(source.label, MAX_FILTER_LABEL_LENGTH);
  const prompt = normalizeText(source.prompt, MAX_FILTER_PROMPT_LENGTH);
  if (!id || !label || !prompt) return null;
  return { id, label, prompt };
};
export const readStoredPhotoFilter = (message: {
  photoFilterId?: string | null;
  photoFilterLabel?: string | null;
  photoFilterPrompt?: string | null;
}): StoredPhotoFilter | null => normalizePhotoFilter({
  id: message.photoFilterId,
  label: message.photoFilterLabel,
  prompt: message.photoFilterPrompt,
});

export const appendPhotoFilter = (prompt: string, filter: StoredPhotoFilter | null) => {
  const basePrompt = prompt.trim().replace(/[\s,]+$/g, '');
  return filter ? `${basePrompt}, ${filter.prompt}` : basePrompt;
};
