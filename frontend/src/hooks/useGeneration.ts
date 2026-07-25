import { useState, useRef, useCallback } from 'react';
import { API_BASE } from '../services/api';
import type { Message, GenParameters } from '../types';
import { resolveRandomPromptsWithSelections } from '../utils/randomPrompts';

const readApiResponse = async (response: Response) => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  const body = await response.text();
  throw new Error(response.status === 404
    ? 'Le backend doit être redémarré pour activer la reprise des générations.'
    : `Réponse serveur inattendue (${response.status})${body ? `: ${body.slice(0, 120)}` : ''}`);
};

export const useGeneration = (
  currentSessionId: string | null,
  params: GenParameters,
  clientIdRef: React.MutableRefObject<string>,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  smoothScrollTo: (id: string) => void,
  fetchSessions: () => void
) => {
  const [isEnhancing, setIsEnhancing] = useState(false);
  const enhancingCount = useRef(0);

  const interruptGeneration = async () => {
    try {
      await fetch(`${API_BASE}/api/generate/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params }),
        credentials: 'include'
      });
    } catch (err) {
      console.error('[Generation] Failed to interrupt:', err);
    }
  };

  const retryMessage = useCallback(async (messageId: string) => {
    const res = await fetch(`${API_BASE}/api/generate/retry/${encodeURIComponent(messageId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params }),
      credentials: 'include'
    });
    const data = await readApiResponse(res);
    if (!res.ok || !data.success) throw new Error(data.error || 'Retry failed');
    setMessages(prev => prev.map(message => message.id === messageId
      ? { ...message, text: '', status: 'pending', duration: 0, generationStartedAt: undefined }
      : message));
    return data;
  }, [params, setMessages]);

  const retryAllIncomplete = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/generate/retry-incomplete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params }),
      credentials: 'include'
    });
    const data = await readApiResponse(res);
    if (!res.ok || !data.success) throw new Error(data.error || 'Bulk retry failed');
    const retriedIds = new Set<string>(data.messageIds || []);
    setMessages(prev => prev.map(message => retriedIds.has(message.id)
      ? { ...message, text: '', status: 'pending', duration: 0, generationStartedAt: undefined }
      : message));
    fetchSessions();
    return data as { queued: number; messageIds: string[] };
  }, [params, setMessages, fetchSessions]);

  const handleSend = useCallback(async (textToSend: string, isRegeneration = false, targetSessionId?: string) => {
    const activeSessionId = targetSessionId || currentSessionId;
    if (!textToSend.trim() || !activeSessionId) return;

    const templatePrompt = textToSend;
    const randomResult = resolveRandomPromptsWithSelections(templatePrompt, params.randomPromptLists);
    const resolvedPrompt = randomResult.prompt;

    if (!isRegeneration) {
      const userMsg: Message = { id: `temp-${Math.random().toString(36).substring(7)}`, role: 'user', text: templatePrompt, timestamp: Date.now() };
      setMessages(prev => [...prev, userMsg]);
    }
    
    try {
      let finalPrompt = resolvedPrompt;
      let finalNegativePrompt = params.negativePrompt;
      const botMsgId = `temp-${Math.random().toString(36).substring(7)}`;

      // 1. Ajouter la bulle bot en chargement (texte vide au début pour éviter la card inutile)
      const initialBotMsg: Message = { 
        id: botMsgId, 
        role: 'bot', 
        prompt: templatePrompt,
        text: resolvedPrompt !== templatePrompt ? resolvedPrompt : '',
        randomSelections: randomResult.selections,
        status: 'pending',
        isEnhancing: params.llmEnabled && !!params.llmProviderId && !isRegeneration,
        timestamp: Date.now(),
        model: params.comfyModel,
        workflow: params.workflowFile,
        width: params.width,
        height: params.height,
        steps: params.steps,
        cfg: params.cfg
      };
      setMessages(prev => [...prev, initialBotMsg]);
      setTimeout(() => smoothScrollTo(`msg-${botMsgId}`), 50);
      
      // 2. Interprétation IA
      if (params.llmEnabled && params.llmProviderId && !isRegeneration) {
        enhancingCount.current++;
        setIsEnhancing(true);
        try {
          const enhanceRes = await fetch(`${API_BASE}/api/llm/enhance-prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              prompt: resolvedPrompt,
              providerId: params.llmProviderId,
              systemMessage: params.llmSystemMessage
            }),
            credentials: 'include'
          });
          const enhanceData = await enhanceRes.json();
          if (enhanceData.enhancedPrompt) {
            finalPrompt = enhanceData.enhancedPrompt;
            if (enhanceData.negativePrompt) finalNegativePrompt = enhanceData.negativePrompt;
            // Mise à jour immédiate de la bulle bot avec le nouveau texte
            setMessages(prev => prev.map(m => m.id === botMsgId ? { 
              ...m, 
              text: finalPrompt, 
              // Keep the template so "Regenerate" performs a fresh random draw.
              prompt: templatePrompt,
              isEnhancing: false 
            } : m));
          } else {
            setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, isEnhancing: false } : m));
          }
        } catch (err) { 
          console.error('[Generation] Enhancement failed:', err); 
          setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, text: finalPrompt, isEnhancing: false } : m));
        } finally { 
          enhancingCount.current--;
          if (enhancingCount.current <= 0) setIsEnhancing(false);
        }
      }

      // 3. Lancer la génération
      const res = await fetch(`${API_BASE}/api/generate/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: finalPrompt, 
          originalPrompt: templatePrompt,
          randomSelections: randomResult.selections,
          sessionId: activeSessionId,
          clientId: clientIdRef.current,
          isRegeneration: isRegeneration,
          params: { 
            ...params, 
            negativePrompt: finalNegativePrompt,
            workflowFile: params.workflowFile,
            nodeMapping: params.nodeMapping,
            // Gestion de la seed
            seed: params.seedMode === 'fixed' && params.forcedSeed ? parseInt(params.forcedSeed, 10) : -1
          }
        }),
        credentials: 'include'
      });
      const data = await res.json();

      if (data.success) {
        setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, id: data.messageId } : m));
        fetchSessions(); 
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setMessages(prev => [...prev, { id: `error-${Date.now()}`, role: 'bot', text: `Error: ${message}`, status: 'failed', timestamp: Date.now() }]);
    }
  }, [currentSessionId, params, clientIdRef, setMessages, smoothScrollTo, fetchSessions]);

  return { handleSend, retryMessage, retryAllIncomplete, interruptGeneration, isEnhancing };
};
