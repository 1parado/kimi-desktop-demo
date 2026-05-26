import { useEffect, useCallback } from 'react';
import { useChatStore } from '../store/chat';
import type { KimiAPI } from '../../preload/index';

declare global {
  interface Window {
    kimiAPI?: KimiAPI;
  }
}

export function useAgent() {
  const {
    sessionId,
    isLoading,
    addUserMessage,
    startAssistantMessage,
    appendAssistantDelta,
    finishAssistantMessage,
    addToolMessage,
    addErrorMessage,
    setSessionId,
    setLoading,
  } = useChatStore();

  useEffect(() => {
    if (!window.kimiAPI) return;

    const unsubscribe = window.kimiAPI.onEvent((event: any) => {
      switch (event.type) {
        case 'turn.started':
          startAssistantMessage();
          break;
        case 'assistant.delta':
          appendAssistantDelta(event.delta);
          break;
        case 'turn.ended':
          finishAssistantMessage();
          break;
        case 'error':
          addErrorMessage(`${event.code ?? 'Error'}: ${event.message ?? 'Unknown agent error'}`);
          break;
        case 'tool.call.started':
          addToolMessage(event.name, event.description ?? `Calling ${event.name}...`);
          break;
      }
    });
    return unsubscribe;
  }, []);

  const createSession = useCallback(async (workDir: string) => {
    const api = window.kimiAPI;
    if (!api) {
      throw new Error('Kimi desktop bridge is unavailable');
    }

    const result = await api.createSession({ workDir });
    setSessionId(result.id);
    return result;
  }, [setSessionId]);

  const sendMessage = useCallback(async (input: string) => {
    const api = window.kimiAPI;
    if (!api) {
      addUserMessage(input);
      addErrorMessage('Kimi desktop bridge is unavailable. Start the app with Electron to chat with Kimi Code.');
      return;
    }

    addUserMessage(input);
    setLoading(true);
    try {
      if (!sessionId) {
        const workDir = await api.getDefaultWorkDir();
        await createSession(workDir);
      }
      await api.prompt(input);
    } catch (error) {
      addErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [sessionId, addUserMessage, addErrorMessage, setLoading, createSession]);

  const cancel = useCallback(async () => {
    await window.kimiAPI?.cancel();
    finishAssistantMessage();
  }, [finishAssistantMessage]);

  return { sessionId, isLoading, sendMessage, cancel, createSession };
}
