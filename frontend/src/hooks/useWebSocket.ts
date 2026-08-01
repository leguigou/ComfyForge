import { useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '../services/api';
import type { Message } from '../types';

export const useWebSocket = (
  isAuthenticated: boolean | null,
  currentSessionId: string | null,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  fetchSessions: () => void,
  fetchSessionDetails: (id: string) => Promise<void>,
  onGenerationStatus?: (
    sessionId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed'
  ) => void | Promise<void>,
  onQueueRemainingChange?: (remaining: number) => void
) => {
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>('');
  const reconnectTimeoutRef = useRef<number | null>(null);
  
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
          if (typeof data.queueRemaining === 'number') {
            onQueueRemainingChangeRef.current?.(data.queueRemaining);
          }
          const status = data.status as 'pending' | 'processing' | 'completed' | 'failed';
          if (data.sessionId === currentSessionIdRef.current) {
            setMessages(prev => prev.map(m => {
              if (m.id === data.messageId || m.id === `temp-${data.messageId}`) {
                return { 
                  ...m, 
                  id: data.messageId, // Ensure we sync with real backend ID
                  status: data.status, 
                  text: Object.prototype.hasOwnProperty.call(data, 'text')
                    ? data.text
                    : (data.status === 'failed' && data.error ? data.error : m.text),
                  prompt: Object.prototype.hasOwnProperty.call(data, 'prompt') ? data.prompt : m.prompt,
                  generationPrompt: Object.prototype.hasOwnProperty.call(data, 'generationPrompt')
                    ? data.generationPrompt
                    : m.generationPrompt,
                  tags: Array.isArray(data.tags) ? data.tags : m.tags,
                  imageUrl: data.imageUrl ? `${API_BASE}${data.imageUrl}` : m.imageUrl,
                  thumbnailUrl: data.thumbnailUrl ? `${API_BASE}${data.thumbnailUrl}` : m.thumbnailUrl,
                  model: data.model || m.model,
                  width: data.width || m.width,
                  height: data.height || m.height,
                  steps: data.steps || m.steps,
                  cfg: data.cfg || m.cfg,
                  seed: data.seed || m.seed,
                  workflow: data.workflow || m.workflow,
                  duration: (data.duration !== undefined && data.duration !== null) ? data.duration : m.duration,
                  generationStartedAt: data.status === 'processing'
                    ? (
                        typeof data.generationStartedAt === 'number'
                          ? data.generationStartedAt
                          : (m.status === 'processing' ? (m.generationStartedAt || Date.now()) : Date.now())
                      )
                    : (data.status === 'pending' ? undefined : m.generationStartedAt)
                };
              }
              if (data.linkedUserMessageId && m.id === data.linkedUserMessageId) {
                return { ...m, text: data.linkedUserText };
              }
              return m;
            }));
          }
          const statusUpdate = onGenerationStatusRef.current?.(data.sessionId, status);
          if (data.status === 'completed' || data.status === 'failed') {
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

  return { clientIdRef };
};
