import { useState, useRef, useCallback } from 'react';
import { API_BASE } from '../services/api';
import type { Message, GenParameters } from '../types';
import { resolveRandomPromptsWithSelections } from '../utils/randomPrompts';
import { shouldEnhancePrompt } from '../utils/promptEnhancement';

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
  fetchSessions: () => void,
  acknowledgeQueueMessage: (messageId: string, temporaryMessageId: string) => void
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
    setMessages(prev => prev.map(message => message.id === messageId
      ? { ...message, text: '', status: 'pending', isStarting: true, duration: 0, generationStartedAt: undefined }
      : message));
    try {
      const res = await fetch(`${API_BASE}/api/generate/retry/${encodeURIComponent(messageId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params }),
        credentials: 'include'
      });
      const data = await readApiResponse(res);
      if (!res.ok || !data.success) throw new Error(data.error || 'Retry failed');
      return data;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Retry failed';
      setMessages(prev => prev.map(message => message.id === messageId
        ? { ...message, text: errorMessage, status: 'failed', isStarting: false }
        : message));
      throw error;
    }
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
      ? { ...message, text: '', status: 'pending', isStarting: true, duration: 0, generationStartedAt: undefined }
      : message));
    fetchSessions();
    return data as { queued: number; messageIds: string[] };
  }, [params, setMessages, fetchSessions]);

  const updatePendingPrompt = useCallback(async (messageId: string, prompt: string, localUserMessageId?: string) => {
    const res = await fetch(`${API_BASE}/api/generate/pending/${encodeURIComponent(messageId)}/prompt`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      credentials: 'include'
    });
    const data = await readApiResponse(res);
    if (!res.ok || !data.success) throw new Error(data.error || 'Prompt update failed');

    setMessages(previous => previous.map(message => {
      if (message.id === data.messageId) {
        return {
          ...message,
          text: data.text,
          prompt: data.prompt,
          generationPrompt: data.generationPrompt,
          tags: data.tags || [],
        };
      }
      if (typeof data.linkedUserText === 'string' && ((data.linkedUserMessageId && message.id === data.linkedUserMessageId)
        || (localUserMessageId && message.id === localUserMessageId))) {
        return { ...message, text: data.linkedUserText };
      }
      return message;
    }));
    return data;
  }, [setMessages]);

  const handleSend = useCallback(async (
    textToSend: string,
    isRegeneration = false,
    targetSessionId?: string,
    skipEnhancement = false,
    runInBackground = false,
    forceEnhancement = false,
    parameterOverrides?: Partial<GenParameters>
  ) => {
    const activeSessionId = targetSessionId || currentSessionId;
    if (!textToSend.trim() || !activeSessionId) return;
    const shouldUpdateVisibleMessages = !runInBackground || activeSessionId === currentSessionId;
    const generationParams = parameterOverrides ? { ...params, ...parameterOverrides } : params;

    const templatePrompt = textToSend;
    const randomResult = resolveRandomPromptsWithSelections(templatePrompt, generationParams.randomPromptLists);
    const resolvedPrompt = randomResult.prompt;
    const botMsgId = `temp-${Math.random().toString(36).substring(7)}`;
    let userMsgId: string | undefined;
    const shouldEnhance = shouldEnhancePrompt({
      llmEnabled: generationParams.llmEnabled,
      hasProvider: Boolean(generationParams.llmProviderId),
      isRegeneration,
      skipEnhancement,
      forceEnhancement
    });
    let recoveryMessageId: string | undefined;
    let recoveryUserMessageId: string | undefined;
    let recoveredPrompt = resolvedPrompt;

    if (!isRegeneration && shouldUpdateVisibleMessages) {
      userMsgId = `temp-${Math.random().toString(36).substring(7)}`;
      const userMsg: Message = { id: userMsgId, role: 'user', text: templatePrompt, timestamp: Date.now() };
      setMessages(prev => [...prev, userMsg]);
    }
    
    try {
      let finalPrompt = resolvedPrompt;
      let finalNegativePrompt = generationParams.negativePrompt;

      // 1. Ajouter la bulle bot en chargement (texte vide au début pour éviter la card inutile)
      const initialBotMsg: Message = { 
        id: botMsgId, 
        role: 'bot', 
        prompt: templatePrompt,
        generationPrompt: resolvedPrompt,
        text: resolvedPrompt !== templatePrompt ? resolvedPrompt : '',
        randomSelections: randomResult.selections,
        status: 'pending',
        isEnhancing: shouldEnhance,
        isStarting: !shouldEnhance,
        timestamp: Date.now(),
        model: generationParams.comfyModel,
        workflow: generationParams.workflowFile,
        width: generationParams.width,
        height: generationParams.height,
        steps: generationParams.steps,
        cfg: generationParams.cfg
      };
      if (shouldUpdateVisibleMessages) {
        setMessages(prev => [...prev, initialBotMsg]);
      }
      if (!runInBackground) {
        setTimeout(() => smoothScrollTo(`msg-${botMsgId}`), 50);
      }
      
      // 2. Interprétation IA
      if (shouldEnhance) {
        enhancingCount.current++;
        setIsEnhancing(true);
        try {
          const enhanceRes = await fetch(`${API_BASE}/api/llm/enhance-prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              prompt: resolvedPrompt,
              originalPrompt: templatePrompt,
              sessionId: activeSessionId,
              providerId: generationParams.llmProviderId,
              systemMessage: generationParams.llmSystemMessage,
              randomSelections: randomResult.selections,
              params: {
                ...generationParams,
                negativePrompt: finalNegativePrompt,
                workflowFile: generationParams.workflowFile,
                nodeMapping: generationParams.nodeMapping,
                seed: generationParams.seedMode === 'fixed' && generationParams.forcedSeed
                  ? parseInt(generationParams.forcedSeed, 10)
                  : -1
              }
            }),
            credentials: 'include'
          });
          const enhanceData = await enhanceRes.json();
          recoveryMessageId = typeof enhanceData.recoveryMessageId === 'string'
            ? enhanceData.recoveryMessageId
            : undefined;
          recoveryUserMessageId = typeof enhanceData.recoveryUserMessageId === 'string'
            ? enhanceData.recoveryUserMessageId
            : undefined;
          if (enhanceData.enhancedPrompt) {
            finalPrompt = enhanceData.enhancedPrompt;
            recoveredPrompt = finalPrompt;
            if (enhanceData.negativePrompt) finalNegativePrompt = enhanceData.negativePrompt;
            // Mise à jour immédiate de la bulle bot avec le nouveau texte
            if (shouldUpdateVisibleMessages) {
              setMessages(prev => prev.map(m => m.id === botMsgId ? {
                ...m,
                text: finalPrompt,
                generationPrompt: finalPrompt,
                // Keep the original template for display/editing; regeneration uses generationPrompt.
                prompt: templatePrompt,
                isEnhancing: false
              } : m));
            }
          } else {
            if (shouldUpdateVisibleMessages) {
              setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, isEnhancing: false } : m));
            }
          }
        } catch (err) { 
          console.error('[Generation] Enhancement failed:', err); 
          if (shouldUpdateVisibleMessages) {
            setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, text: finalPrompt, isEnhancing: false } : m));
          }
        } finally { 
          enhancingCount.current--;
          if (enhancingCount.current <= 0) setIsEnhancing(false);
        }
      }

      // 3. Lancer la génération. The card remains in a counter-free starting
      // state until the processing event confirms that rendering has begun.
      if (shouldUpdateVisibleMessages) {
        setMessages(previous => previous.map(message => message.id === botMsgId
          ? { ...message, status: 'pending', isStarting: true, generationStartedAt: undefined }
          : message));
      }
      const res = await fetch(`${API_BASE}/api/generate/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: finalPrompt, 
          originalPrompt: templatePrompt,
          recoveryMessageId,
          randomSelections: randomResult.selections,
          sessionId: activeSessionId,
          clientId: clientIdRef.current,
          isRegeneration: isRegeneration,
          params: { 
            ...generationParams,
            negativePrompt: finalNegativePrompt,
            workflowFile: generationParams.workflowFile,
            nodeMapping: generationParams.nodeMapping,
            // Gestion de la seed
            seed: generationParams.seedMode === 'fixed' && generationParams.forcedSeed ? parseInt(generationParams.forcedSeed, 10) : -1
          }
        }),
        credentials: 'include'
      });
      const data = await readApiResponse(res);

      if (res.ok && data.success) {
        if (shouldUpdateVisibleMessages) {
          acknowledgeQueueMessage(data.messageId, botMsgId);
          setMessages(prev => {
            const acknowledgedUserMessageId = typeof data.userMessageId === 'string'
              ? data.userMessageId
              : recoveryUserMessageId;
            const acknowledged = prev.map(m => {
              if (userMsgId && acknowledgedUserMessageId && m.id === userMsgId) {
                return { ...m, id: acknowledgedUserMessageId };
              }
              if (m.id !== botMsgId && m.id !== data.messageId) return m;
              const processingWasAlreadyConfirmed = m.status === 'processing';
              return {
                ...m,
                id: data.messageId,
                status: processingWasAlreadyConfirmed ? 'processing' as const : 'pending' as const,
                isStarting: processingWasAlreadyConfirmed ? false : (m.isStarting ?? true),
                generationStartedAt: processingWasAlreadyConfirmed ? m.generationStartedAt : undefined,
                generationPrompt: finalPrompt,
                tags: data.tags || []
              };
            });
            const seenIds = new Set<string>();
            return acknowledged.filter(message => {
              if (seenIds.has(message.id)) return false;
              seenIds.add(message.id);
              return true;
            });
          });
        }
        fetchSessions(); 
        return data;
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (shouldUpdateVisibleMessages) {
        setMessages(prev => prev.map(item => item.id === botMsgId
          ? {
              ...item,
              id: recoveryMessageId || item.id,
              text: message,
              generationPrompt: recoveredPrompt,
              status: 'failed',
              isEnhancing: false
            }
          : item));
      }
      if (runInBackground) throw error;
    }
  }, [currentSessionId, params, clientIdRef, setMessages, smoothScrollTo, fetchSessions, acknowledgeQueueMessage]);

  return { handleSend, retryMessage, retryAllIncomplete, updatePendingPrompt, interruptGeneration, isEnhancing };
};
