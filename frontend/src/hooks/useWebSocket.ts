import { useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { API_BASE } from '../services/api';
import type { Message } from '../types';

export type QueueUpdatePayload = {
  messageId: string;
  status: 'pending' | 'preparing' | 'processing' | 'completed' | 'failed';
  text?: string;
  error?: string;
  prompt?: string;
  generationPrompt?: string;
  tags?: Message['tags'];
  imageUrl?: string;
  thumbnailUrl?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  workflow?: string;
  duration?: number;
  generationStartedAt?: number;
  queueRemaining?: number;
  linkedUserMessageId?: string;
  linkedUserText?: string;
  [key: string]: unknown;
};

export const applyQueueUpdateToMessages = (
  messages: Message[],
  data: QueueUpdatePayload,
  now = Date.now(),
  temporaryMessageId?: string
) => messages.map(message => {
  if (
    message.id === data.messageId
    || message.id === `temp-${data.messageId}`
    || message.id === temporaryMessageId
  ) {
    const nextDuration = data.duration ?? message.duration ?? 0;
    const existingElapsed = typeof message.generationStartedAt === 'number'
      ? now - message.generationStartedAt
      : -1;
    const hasValidLocalStart = message.status === 'processing'
      && existingElapsed >= 0
      && existingElapsed <= 10 * 60 * 1000;
    return {
      ...message,
      id: data.messageId,
      status: data.status,
      text: Object.prototype.hasOwnProperty.call(data, 'text')
        ? data.text
        : (data.status === 'failed' && data.error ? data.error : message.text),
      prompt: Object.prototype.hasOwnProperty.call(data, 'prompt') ? data.prompt : message.prompt,
      generationPrompt: Object.prototype.hasOwnProperty.call(data, 'generationPrompt')
        ? data.generationPrompt
        : message.generationPrompt,
      tags: Array.isArray(data.tags) ? data.tags : message.tags,
      imageUrl: data.imageUrl ? `${API_BASE}${data.imageUrl}` : message.imageUrl,
      thumbnailUrl: data.thumbnailUrl ? `${API_BASE}${data.thumbnailUrl}` : message.thumbnailUrl,
      model: data.model || message.model,
      width: data.width || message.width,
      height: data.height || message.height,
      steps: data.steps || message.steps,
      cfg: data.cfg || message.cfg,
      seed: data.seed ?? message.seed,
      workflow: data.workflow || message.workflow,
      duration: nextDuration,
      isStarting: data.status === 'preparing',
      generationStartedAt: data.status === 'processing'
        ? (hasValidLocalStart ? message.generationStartedAt : now - Math.max(0, nextDuration) * 1000)
        : (data.status === 'pending' ? undefined : message.generationStartedAt)
    } as Message;
  }
  if (data.linkedUserMessageId && message.id === data.linkedUserMessageId) {
    return { ...message, text: data.linkedUserText ?? message.text };
  }
  return message;
});

export const useWebSocket = (
  isAuthenticated: boolean | null,
  currentSessionId: string | null,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  fetchSessions: () => void,
  fetchSessionDetails: (id: string) => Promise<void>,
  onGenerationStatus?: (
    sessionId: string,
    status: 'pending' | 'preparing' | 'processing' | 'completed' | 'failed'
  ) => void | Promise<void>,
  onQueueRemainingChange?: (remaining: number) => void
) => {
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>('');
  const reconnectTimeoutRef = useRef<number | null>(null);
  const latestQueueUpdatesRef = useRef<Map<string, QueueUpdatePayload>>(new Map());
  const queueMessageAliasesRef = useRef<Map<string, string>>(new Map());
  
  // Refs to maintain fresh values inside WebSocket handlers
  const currentSessionIdRef = useRef(currentSessionId);
  const onGenerationStatusRef = useRef(onGenerationStatus);
  const onQueueRemainingChangeRef = useRef(onQueueRemainingChange);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);
  useEffect(() => {
    onGenerationStatusRef.current = onGenerationStatus;
  }, [onGenerationStatus]);
  useEffect(() => {
    onQueueRemainingChangeRef.current = onQueueRemainingChange;
  }, [onQueueRemainingChange]);

  const connectRef = useRef<() => void>(() => {});

  const acknowledgeQueueMessage = useCallback((messageId: string, temporaryMessageId: string) => {
    queueMessageAliasesRef.current.set(messageId, temporaryMessageId);
    if (queueMessageAliasesRef.current.size > 200) {
      const oldestMessageId = queueMessageAliasesRef.current.keys().next().value;
      if (oldestMessageId) queueMessageAliasesRef.current.delete(oldestMessageId);
    }

    const update = latestQueueUpdatesRef.current.get(messageId);
    if (!update) return;
    latestQueueUpdatesRef.current.delete(messageId);
    setMessages(previous => applyQueueUpdateToMessages(previous, update, Date.now(), temporaryMessageId));
    if (update.status === 'completed' || update.status === 'failed') {
      queueMessageAliasesRef.current.delete(messageId);
    }
  }, [setMessages]);

  const connect = useCallback(() => {
    if (!isAuthenticated) return;
    
    if (wsRef.current) wsRef.current.close();
    if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsBase = API_BASE.startsWith('http') ? API_BASE.replace(/^http/, 'ws') : `${wsProtocol}//${window.location.host}`;
    const wsUrl = `${wsBase}/api/ws`;

    console.log(`[WS] Connecting to: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] Connected');
      fetchSessions();
      if (currentSessionIdRef.current) {
        fetchSessionDetails(currentSessionIdRef.current);
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') {
          console.log('[WS] Client ID acknowledged:', data.clientId);
          clientIdRef.current = data.clientId;
          if (typeof data.queueRemaining === 'number') {
            onQueueRemainingChangeRef.current?.(data.queueRemaining);
          }
        } else if (data.type === 'queue_update') {
          console.log('[WS] Queue update:', data);
          if (typeof data.messageId === 'string') {
            latestQueueUpdatesRef.current.set(data.messageId, data as QueueUpdatePayload);
            if (latestQueueUpdatesRef.current.size > 200) {
              const oldestMessageId = latestQueueUpdatesRef.current.keys().next().value;
              if (oldestMessageId) latestQueueUpdatesRef.current.delete(oldestMessageId);
            }
          }
          if (data.serviceUnavailable === true && data.error) {
            toast.error(String(data.error), {
              id: 'comfyui-unavailable',
              duration: 10000
            });
          }
          if (typeof data.queueRemaining === 'number') {
            onQueueRemainingChangeRef.current?.(data.queueRemaining);
          }
          const status = data.status as 'pending' | 'preparing' | 'processing' | 'completed' | 'failed';
          if (data.sessionId === currentSessionIdRef.current) {
            const temporaryMessageId = queueMessageAliasesRef.current.get(data.messageId);
            setMessages(previous => applyQueueUpdateToMessages(
              previous,
              data as QueueUpdatePayload,
              Date.now(),
              temporaryMessageId
            ));
          }
          const statusUpdate = onGenerationStatusRef.current?.(data.sessionId, status);
          if (data.status === 'completed' || data.status === 'failed') {
            queueMessageAliasesRef.current.delete(data.messageId);
            void Promise.resolve(statusUpdate).finally(fetchSessions);
          }
        }
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };

    ws.onclose = (e) => {
      console.log('[WS] Closed, reconnecting in 3s...', e.reason);
      wsRef.current = null;
      reconnectTimeoutRef.current = window.setTimeout(() => connectRef.current(), 3000);
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
      ws.close();
    };
  }, [isAuthenticated, fetchSessions, fetchSessionDetails, setMessages]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (isAuthenticated) {
      connect();
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          fetchSessions();
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            console.log('[WS] Visibility wake, reconnecting...');
            connect();
          }
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (wsRef.current) wsRef.current.close();
        if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      };
    }
  }, [isAuthenticated, connect, fetchSessions]);

  useEffect(() => {
    if (!isAuthenticated || !onQueueRemainingChange) return;

    let cancelled = false;
    const syncQueueFromApi = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await fetch(`${API_BASE}/api/generate/active`, {
          credentials: 'include'
        });
        if (!response.ok) return;
        const activeGenerations = await response.json();
        if (!cancelled && Array.isArray(activeGenerations)) {
          onQueueRemainingChangeRef.current?.(activeGenerations.length);
        }
      } catch {
        // The WebSocket remains the primary source; the next sync will retry.
      }
    };

    const handlePageVisible = () => {
      if (document.visibilityState === 'visible') void syncQueueFromApi();
    };

    void syncQueueFromApi();
    const interval = window.setInterval(syncQueueFromApi, 4000);
    document.addEventListener('visibilitychange', handlePageVisible);
    window.addEventListener('pageshow', handlePageVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handlePageVisible);
      window.removeEventListener('pageshow', handlePageVisible);
    };
  }, [isAuthenticated, onQueueRemainingChange]);

  return { clientIdRef, acknowledgeQueueMessage };
};
