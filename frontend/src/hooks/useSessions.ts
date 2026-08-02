import React, { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../services/api';
import type { Session, Message, AppView } from '../types';
import { resolveGenerationStartedAt } from '../utils/generationTimer';

const MESSAGE_PAGE_SIZE = 60;

type HistoryCursor = { timestamp: number; id: string };
type SessionFetchOptions = { reset?: boolean; all?: boolean };

const mergeServerMessage = (incoming: Message, existing: Message | undefined) => {
  const mergedDuration = incoming.duration ?? existing?.duration;
  const generationStartedAt = resolveGenerationStartedAt(
    incoming.status,
    incoming.generationStartedAt,
    existing?.generationStartedAt,
    Date.now(),
    mergedDuration ?? 0
  );
  if (!existing) {
    return generationStartedAt === undefined
      ? incoming
      : { ...incoming, generationStartedAt };
  }

  const sameTags = JSON.stringify(incoming.tags || []) === JSON.stringify(existing.tags || []);
  const sameRandomSelections = JSON.stringify(incoming.randomSelections || []) === JSON.stringify(existing.randomSelections || []);
  const unchanged = existing.imageUrl === incoming.imageUrl
    && existing.thumbnailUrl === incoming.thumbnailUrl
    && existing.status === incoming.status
    && existing.text === incoming.text
    && existing.prompt === incoming.prompt
    && existing.generationPrompt === incoming.generationPrompt
    && existing.isFavorite === incoming.isFavorite
    && existing.isPromptFavorite === incoming.isPromptFavorite
    && existing.duration === mergedDuration
    && existing.generationStartedAt === generationStartedAt
    && sameTags
    && sameRandomSelections;

  return unchanged
    ? existing
    : { ...incoming, duration: mergedDuration, generationStartedAt };
};

export const useSessions = (view: AppView, isAuthenticated: boolean | null) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    return localStorage.getItem('comfyforge.currentSessionId');
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [activeInfoId, setActiveInfoId] = useState<string | null>(null);
  const [massActionType, setMassActionType] = useState<'archiveAll' | 'deleteAll' | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const historySessionRef = useRef<string | null>(null);
  const historyCursorRef = useRef<HistoryCursor | null>(null);
  const historyHasMoreRef = useRef(false);
  const loadingOlderRef = useRef(false);

  const fetchSessions = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const url = view === 'archives' ? `${API_BASE}/api/history/archives` : `${API_BASE}/api/history`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch history');
      const data = await res.json();
      setSessions(data);
      if (data.length > 0 && view !== 'archives') {
        setCurrentSessionId(prev => (
          prev && data.some((session: Session) => session.id === prev)
            ? prev
            : data[0].id
        ));
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
    }
  }, [view, isAuthenticated]);

  const createNewSession = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/history`, { method: 'POST', credentials: 'include' });
    const data = await res.json();
    setSessions(prev => [data, ...prev]);
    setCurrentSessionId(data.id);
    setMessages([]);
    return data.id;
  }, []);

  const fetchMessagePage = useCallback(async (
    id: string,
    mode: 'latest' | 'older',
    options: SessionFetchOptions = {}
  ) => {
    const isNewSession = historySessionRef.current !== id;
    const shouldReplace = options.reset === true || options.all === true || isNewSession;
    if (mode === 'older' && (loadingOlderRef.current || !historyHasMoreRef.current || !historyCursorRef.current)) {
      return 0;
    }

    if (isNewSession) {
      historySessionRef.current = id;
      historyCursorRef.current = null;
      historyHasMoreRef.current = false;
      setHasMoreMessages(false);
      setMessages([]);
    }

    if (mode === 'older') {
      loadingOlderRef.current = true;
      setIsLoadingOlderMessages(true);
    }

    try {
      const query = new URLSearchParams();
      if (options.all) {
        query.set('all', 'true');
      } else {
        query.set('limit', String(MESSAGE_PAGE_SIZE));
        if (mode === 'older' && historyCursorRef.current) {
          query.set('beforeTimestamp', String(historyCursorRef.current.timestamp));
          query.set('beforeId', historyCursorRef.current.id);
        }
      }
      const res = await fetch(`${API_BASE}/api/history/${id}?${query.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch session details');
      const data = await res.json();
      if (historySessionRef.current !== id) return 0;
      if (Array.isArray(data.messages)) {
        const incomingMessages = data.messages as Message[];
        setMessages(prev => {
          const existingById = new Map(prev.map(message => [message.id, message]));
          const mergedIncoming = incomingMessages.map(message => (
            mergeServerMessage(message, existingById.get(message.id))
          ));

          if (shouldReplace) {
            const tempMessages = prev.filter(message => message.id.startsWith('temp-'));
            return [
              ...mergedIncoming,
              ...tempMessages.filter(tm => (
                tm.status === 'failed'
                || !mergedIncoming.some((nm: Message) => (
                  nm.role === tm.role && (nm.prompt === tm.text || nm.text === tm.text)
                ))
              ))
            ];
          }

          if (mode === 'older') {
            const existingIds = new Set(prev.map(message => message.id));
            return [...mergedIncoming.filter(message => !existingIds.has(message.id)), ...prev];
          }

          const reconciledTempUserIds = new Set(prev
            .filter(message => message.id.startsWith('temp-') && message.role === 'user')
            .filter(message => mergedIncoming.some(incoming => (
              incoming.role === 'user'
              && incoming.text.trim() === message.text.trim()
              && Math.abs(incoming.timestamp - message.timestamp) <= 5 * 60 * 1000
            )))
            .map(message => message.id));
          const reconciledPrevious = prev.filter(message => !reconciledTempUserIds.has(message.id));
          const incomingById = new Map(mergedIncoming.map(message => [message.id, message]));
          const next = reconciledPrevious.map(message => incomingById.get(message.id) || message);
          const existingIds = new Set(reconciledPrevious.map(message => message.id));
          mergedIncoming.forEach(message => {
            if (!existingIds.has(message.id)) next.push(message);
          });
          return next.sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
        });

        if (shouldReplace || mode === 'older') {
          const nextCursor = data.nextCursor;
          historyCursorRef.current = nextCursor
            && Number.isFinite(Number(nextCursor.timestamp))
            && typeof nextCursor.id === 'string'
            ? { timestamp: Number(nextCursor.timestamp), id: nextCursor.id }
            : null;
          historyHasMoreRef.current = Boolean(data.hasMore && historyCursorRef.current);
          setHasMoreMessages(historyHasMoreRef.current);
        }
        return incomingMessages.length;
      }
    } catch (err) {
      console.error('Error fetching session details:', err);
    } finally {
      if (mode === 'older') {
        loadingOlderRef.current = false;
        setIsLoadingOlderMessages(false);
      }
    }
    return 0;
  }, []);

  const fetchSessionDetails = useCallback(async (id: string, options: SessionFetchOptions = {}) => {
    await fetchMessagePage(id, 'latest', options);
  }, [fetchMessagePage]);

  const loadOlderMessages = useCallback(async () => {
    if (!currentSessionId) return 0;
    return fetchMessagePage(currentSessionId, 'older');
  }, [currentSessionId, fetchMessagePage]);

  useEffect(() => {
    if (isAuthenticated && currentSessionId && (view === 'chat' || view === 'archives')) {
      fetchSessionDetails(currentSessionId, {
        reset: historySessionRef.current !== currentSessionId
      });
    }
  }, [currentSessionId, view, fetchSessionDetails, isAuthenticated]);

  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem('comfyforge.currentSessionId', currentSessionId);
    } else {
      localStorage.removeItem('comfyforge.currentSessionId');
    }
  }, [currentSessionId]);

  const renameSession = async (id: string, newTitle: string) => {
    if (!newTitle.trim()) {
      setRenamingId(null);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/history/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
        credentials: 'include'
      });
      if (res.ok) {
        setSessions(prev => prev.map(s => s.id === id ? { ...s, title: newTitle } : s));
      }
    } catch (err) {
      console.error('Error renaming session:', err);
    } finally {
      setRenamingId(null);
    }
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSessionToDelete(id);
  };

  const confirmDeleteSession = async () => {
    if (!sessionToDelete) return;
    try {
      await fetch(`${API_BASE}/api/history/${sessionToDelete}`, { 
        method: 'DELETE', 
        credentials: 'include' 
      });
      setSessions(prev => prev.filter(s => s.id !== sessionToDelete));
      if (currentSessionId === sessionToDelete) {
        setCurrentSessionId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Error deleting session:', err);
    } finally {
      setSessionToDelete(null);
    }
  };

  const toggleArchive = async (id: string, isArchived: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/api/history/${id}/archive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived }),
        credentials: 'include'
      });
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== id));
        if (currentSessionId === id) {
          setCurrentSessionId(null);
          setMessages([]);
        }
        setSessionToDelete(null);
      }
    } catch (err) {
      console.error('Error archiving session:', err);
    }
  };

  const archiveAllSessions = async () => {
    await fetch(`${API_BASE}/api/history/archive-all`, { method: 'POST', credentials: 'include' });
    fetchSessions();
    setMassActionType(null);
  };

  const deleteSessions = async (scope: 'active' | 'archived' | 'all') => {
    const response = await fetch(`${API_BASE}/api/history/all/${scope}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) throw new Error('Failed to delete sessions');
    if (
      scope === 'all'
      || (scope === 'archived' && view === 'archives')
      || (scope === 'active' && view !== 'archives')
    ) {
      setCurrentSessionId(null);
      setMessages([]);
    }
    await fetchSessions();
    setMassActionType(null);
  };

  const deleteMessage = async (messageId: string) => {
    if (!currentSessionId) return;
    await fetch(`${API_BASE}/api/history/${currentSessionId}/message/${messageId}`, { method: 'DELETE', credentials: 'include' });
    setMessages(prev => prev.filter(m => m.id !== messageId));
    setMessageToDelete(null);
  };

  return {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    messages,
    setMessages,
    sessionToDelete,
    setSessionToDelete,
    messageToDelete,
    setMessageToDelete,
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    activeInfoId,
    setActiveInfoId,
    massActionType,
    setMassActionType,
    fetchSessions,
    createNewSession,
    fetchSessionDetails,
    renameSession,
    deleteSession,
    confirmDeleteSession,
    toggleArchive,
    archiveAllSessions,
    deleteSessions,
    deleteMessage,
    hasMoreMessages,
    isLoadingOlderMessages,
    loadOlderMessages
  };
};
