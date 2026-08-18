type TextClipboard = Pick<Clipboard, 'writeText'>;

const copyTextWithSelection = (text: string, doc: Document) => {
  if (!doc.body || typeof doc.execCommand !== 'function') return false;

  const activeElement = typeof HTMLElement !== 'undefined' && doc.activeElement instanceof HTMLElement
    ? doc.activeElement
    : null;
  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  Object.assign(textarea.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    padding: '0',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  });

  doc.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return doc.execCommand('copy');
  } finally {
    textarea.remove();
    activeElement?.focus({ preventScroll: true });
  }
};

/**
 * Copies text in secure contexts and retains support for phones accessing the
 * app through a local HTTP address, where the asynchronous Clipboard API is
 * unavailable.
 */
export const copyTextToClipboard = async (
  text: string,
  clipboard: TextClipboard | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
) => {
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Some mobile browsers expose the API but reject it outside a trusted
      // context. Keep the synchronous selection-based fallback below.
    }
  }

  if (!doc || !copyTextWithSelection(text, doc)) {
    throw new Error('Unable to copy text');
  }
};
