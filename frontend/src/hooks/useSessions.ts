import React, { useState, useCallback, useEffect } from 'react';
import { API_BASE } from '../services/api';
import type { Session, Message } from '../types';

export const useSessions = (view: 'chat' | 'gallery' | 'archives', isAuthenticated: boolean | null) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [activeInfoId, setActiveInfoId] = useState<string | null>(null);
  const [massActionType, setMassActionType] = useState<'archiveAll' | 'deleteAll' | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const url = view === 'archives' ? `${API_BASE}/api/history/archives` : `${API_BASE}/api/history`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch history');
      const data = await res.json();
      setSessions(data);
      if (data.length > 0 && view !== 'archives') {
        setCurrentSessionId(prev => prev || data[0].id);
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

  const fetchSessionDetails = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/history/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch session details');
      const data = await res.json();
      if (data.messages) {
        setMessages(prev => {
          const tempMessages = prev.filter(m => m.id.startsWith('temp-'));
          
          // Deep merge logic to prevent flickering
          const updatedMessages = data.messages.map((newMsg: Message) => {
            const existingMsg = prev.find(m => m.id === newMsg.id);
            if (!existingMsg) return newMsg;
            
            // If data hasn't changed significantly, keep existing reference
            const hasImageUrlChanged = existingMsg.imageUrl !== newMsg.imageUrl;
            const hasStatusChanged = existingMsg.status !== newMsg.status;
            const hasTextChanged = existingMsg.text !== newMsg.text;

            if (!hasImageUrlChanged && !hasStatusChanged && !hasTextChanged) {
              return existingMsg;
            }

            // Merge duration if missing in new data but present in existing
            const mergedDuration = (newMsg.duration === undefined || newMsg.duration === null) 
              ? existingMsg.duration 
              : newMsg.duration;

            return { ...newMsg, duration: mergedDuration };
          });

          // Check if the overall messages list actually changed to avoid reference change
          const isSameLength = updatedMessages.length === prev.filter(m => !m.id.startsWith('temp-')).length;
          if (isSameLength && updatedMessages.every((m: Message, i: number) => m === prev[i])) {
            return prev;
          }

          return [...updatedMessages, ...tempMessages.filter(tm => !updatedMessages.some((nm: Message) => nm.role === tm.role && (nm.prompt === tm.text || nm.text === tm.text)))];
        });
      }
    } catch (err) {
      console.error('Error fetching session details:', err);
    }
  }, []);

  useEffect(() => {
    if (currentSessionId && (view === 'chat' || view === 'archives')) {
      fetchSessionDetails(currentSessionId);
    }
  }, [currentSessionId, view, fetchSessionDetails]);

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

  const deleteAllActiveSessions = async () => {
    await fetch(`${API_BASE}/api/history/all/active`, { method: 'DELETE', credentials: 'include' });
    fetchSessions();
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
    deleteAllActiveSessions,
    deleteMessage
  };
};
