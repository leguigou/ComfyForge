import { API_BASE } from '../services/api';

export const downloadImageByMessageId = async (messageId: string, filename: string) => {
  const response = await fetch(
    `${API_BASE}/api/gallery/download/${encodeURIComponent(messageId)}`,
    { credentials: 'include' },
  );
  if (!response.ok) throw new Error('Unable to download image');

  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};
