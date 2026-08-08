export const MAX_CLIPBOARD_PROMPT_LENGTH = 20_000;

const LORA_TAG_PATTERN = /<\s*lora\s*:[^>\r\n]*>/gi;

export const stripClipboardLoraTags = (value: string) => value
  .replace(LORA_TAG_PATTERN, '')
  .replace(/([,;])(?:\s*[,;])+/g, '$1')
  .replace(/(^|\n)[ \t]*[,;][ \t]*/g, '$1')
  .replace(/[ \t]*[,;][ \t]*(?=\n|$)/g, '')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/[ \t]+\n/g, '\n');

export const normalizeClipboardPrompt = (value: string) => stripClipboardLoraTags(value
  .split('\0').join('')
  .replace(/\r\n?/g, '\n'))
  .trim();

export const isClipboardPromptAllowed = (value: string) => (
  value.length > 0 && value.length <= MAX_CLIPBOARD_PROMPT_LENGTH
);

export const isClipboardAutoGenerateSupported = (
  clipboard: unknown,
  secureContext: boolean,
) => {
  if (!secureContext || !clipboard || typeof clipboard !== 'object') return false;
  const candidate = clipboard as { readText?: unknown; onclipboardchange?: unknown };
  return typeof candidate.readText === 'function' && 'onclipboardchange' in candidate;
};
