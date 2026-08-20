import { API_BASE } from './api';
import type { GalleryItem } from '../types';

type GalleryGroupSelection = {
  messageId: string;
  groupCount?: number;
  manualGroupId?: string | null;
};

export const getCenteredGalleryOffset = (targetIndex: number, total: number, pageSize: number) => {
  const safePageSize = Math.max(1, Math.round(pageSize));
  const safeTotal = Math.max(0, Math.round(total));
  const centeredOffset = Math.max(0, Math.round(targetIndex) - Math.floor(safePageSize / 2));
  return Math.min(centeredOffset, Math.max(0, safeTotal - safePageSize));
};

export const centerGalleryItem = (container: HTMLElement | null, messageId: string) => {
  const element = container
    ? Array.from(container.querySelectorAll<HTMLElement>('[data-gallery-message-id]'))
        .find(candidate => candidate.dataset.galleryMessageId === messageId)
    : undefined;
  if (!container || !element) return false;

  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const elementTop = container.scrollTop + elementRect.top - containerRect.top;
  const targetScroll = elementTop - (container.clientHeight - elementRect.height) / 2;
  container.scrollTo({
    top: Math.max(0, Math.min(targetScroll, container.scrollHeight - container.clientHeight)),
    behavior: 'smooth',
  });
  return true;
};

export const centerGroupAfterRender = (container: HTMLElement | null, messageId: string, attempts = 120) => {
  if (centerGalleryItem(container, messageId) || attempts <= 0) return;
  window.requestAnimationFrame(() => centerGroupAfterRender(container, messageId, attempts - 1));
};

export const expandGalleryGroupMessageIds = async (items: GalleryGroupSelection[]) => {
  const groups = await Promise.all(items.map(async item => {
    if ((item.groupCount || 1) <= 1) return [item.messageId];
    const response = await fetch(`${API_BASE}/api/gallery/group/${encodeURIComponent(item.messageId)}`, {
      credentials: 'include',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.items)) throw new Error(data.error || '');
    return data.items.map((member: { messageId: string }) => member.messageId);
  }));
  return [...new Set(groups.flat())];
};

export const expandGalleryGroupItems = async (items: GalleryItem[], sessionScoped = false) => {
  const groups = await Promise.all(items.map(async item => {
    if ((item.groupCount || 1) <= 1) return [item];
    const query = sessionScoped ? `?sessionId=${encodeURIComponent(item.sessionId)}` : '';
    const response = await fetch(`${API_BASE}/api/gallery/group/${encodeURIComponent(item.messageId)}${query}`, {
      credentials: 'include',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.items)) throw new Error(data.error || '');
    return data.items as GalleryItem[];
  }));
  const uniqueItems = new Map<string, GalleryItem>();
  groups.flat().forEach(item => uniqueItems.set(item.messageId, item));
  return [...uniqueItems.values()];
};

export const createManualGalleryGroup = async (messageIds: string[]) => {
  const response = await fetch(`${API_BASE}/api/gallery/manual-groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ messageIds }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.manualGroupId !== 'string') throw new Error(data.error || '');
  return data.manualGroupId as string;
};

export const createPositionedGroup = async (
  items: GalleryGroupSelection[],
  loadedItems: GalleryGroupSelection[],
  startIndex: number,
  total: number,
  pageSize: number,
) => {
  const coverId = items[0].messageId;
  const coverLoadedIndex = loadedItems.findIndex(item => item.messageId === coverId);
  const messageIds = await expandGalleryGroupMessageIds(items);
  const manualGroupId = await createManualGalleryGroup(messageIds);
  return [
    coverId,
    messageIds,
    manualGroupId,
    getCenteredGalleryOffset(
      startIndex + Math.max(0, coverLoadedIndex),
      Math.max(1, total - items.length + 1),
      pageSize,
    ),
  ] as const;
};

export const ungroupManualGalleryGroup = async (messageId: string) => {
  const response = await fetch(`${API_BASE}/api/gallery/group/${encodeURIComponent(messageId)}/manual`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '');
};

export const featureGalleryGroupImage = async (messageId: string) => {
  const response = await fetch(`${API_BASE}/api/gallery/group/${encodeURIComponent(messageId)}/cover`, {
    method: 'PUT',
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '');
};

export const markManualGalleryGroup = <T extends { id?: string; messageId?: string }>(
  items: T[],
  groupedIds: Set<string>,
  manualGroupId: string | null,
  coverId?: string,
) => items.map(item => {
  const id = item.messageId || item.id || '';
  return groupedIds.has(id)
    ? { ...item, manualGroupId, isGroupCover: manualGroupId && id === coverId ? 1 : 0 }
    : item;
});
