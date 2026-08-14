const convertImageToPng = async (blob: Blob) => {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare image for clipboard');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('Unable to encode image')), 'image/png');
    });
  } finally {
    bitmap.close();
  }
};

export class ImageClipboardError extends Error {
  code: 'INSECURE_CONTEXT' | 'UNSUPPORTED';

  constructor(code: 'INSECURE_CONTEXT' | 'UNSUPPORTED') {
    super(code);
    this.name = 'ImageClipboardError';
    this.code = code;
  }
}

export const copyImageToClipboard = (url: string) => {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new ImageClipboardError('INSECURE_CONTEXT');
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new ImageClipboardError('UNSUPPORTED');
  }
  const pngPromise = fetch(url, { credentials: 'include' }).then(async response => {
    if (!response.ok) throw new Error('Unable to load image');
    return convertImageToPng(await response.blob());
  });
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
};
