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
  ) => void | Promise<void>
) => {
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>('');
  const reconnectTimeoutRef = useRef<number | null>(null);
  
  // Refs to maintain fresh values inside WebSocket handlers
  const currentSessionIdRef = useRef(currentSessionId);
  const onGenerationStatusRef = useRef(onGenerationStatus);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);
  useEffect(() => {
    onGenerationStatusRef.current = onGenerationStatus;
  }, [onGenerationStatus]);

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
        } else if (data.type === 'queue_update') {
          console.log('[WS] Queue update:', data);
          const status = data.status as 'pending' | 'processing' | 'completed' | 'failed';
          if (data.sessionId === currentSessionIdRef.current) {
            setMessages(prev => prev.map(m => {
              if (m.id === data.messageId || m.id === `temp-${data.messageId}`) {
                return { 
                  ...m, 
                  id: data.messageId, // Ensure we sync with real backend ID
                  status: data.status, 
                  text: data.status === 'failed' && data.error ? data.error : m.text,
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
                    ? (m.generationStartedAt || Date.now())
                    : m.generationStartedAt
                };
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

  return { clientIdRef };
};
