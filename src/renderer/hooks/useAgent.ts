import { useEffect, useCallback } from 'react';
import { useChatStore } from '../store/chat';
import { useSettingsStore } from '../store/settings';
import type { ApprovalPrompt } from '../store/chat';
import type { KimiAPI, PromptInputPart } from '../../preload/index';

export interface SendMessageInput {
  text: string;
  prompt: string | PromptInputPart[];
  displayText?: string;
}

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
    startToolMessage,
    updateToolMessage,
    finishToolMessage,
    addErrorMessage,
    setPendingApproval,
    setSessionId,
    setLoading,
  } = useChatStore();
  const { workDir, selectedModel, thinking, permission, loadSettings } = useSettingsStore();

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!window.kimiAPI) return;

    const unsubscribeEvent = window.kimiAPI.onEvent((event: any) => {
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
          startToolMessage(
            event.toolCallId,
            event.name,
            event.description ?? formatToolDisplay(event.display) ?? formatUnknown(event.args),
          );
          break;
        case 'tool.progress':
          updateToolMessage(event.toolCallId, formatToolProgress(event.update));
          break;
        case 'tool.result':
          finishToolMessage(
            event.toolCallId,
            event.isError ? 'failed' : 'completed',
            formatToolResult(event.output, event.isError),
          );
          break;
      }
    });

    const unsubscribeApproval = window.kimiAPI.onApprovalRequest((payload) => {
      setPendingApproval(formatApprovalPrompt(payload.requestId, payload.request));
    });

    const unsubscribeQuestion = window.kimiAPI.onQuestionRequest((payload) => {
      window.kimiAPI?.respondQuestion({ requestId: payload.requestId, response: null });
    });

    return () => {
      unsubscribeEvent();
      unsubscribeApproval();
      unsubscribeQuestion();
    };
  }, []);

  const createSession = useCallback(async (sessionWorkDir: string) => {
    const api = window.kimiAPI;
    if (!api) {
      throw new Error('Kimi desktop bridge is unavailable');
    }

    const result = await api.createSession({
      workDir: sessionWorkDir,
      model: selectedModel,
      thinking,
      permission,
    });
    setSessionId(result.id);
    void loadSettings();
    return result;
  }, [selectedModel, thinking, permission, setSessionId, loadSettings]);

  const sendMessage = useCallback(async (input: SendMessageInput) => {
    const api = window.kimiAPI;
    const displayText = input.displayText ?? input.text;
    if (!api) {
      addUserMessage(displayText);
      addErrorMessage('Kimi desktop bridge is unavailable. Start the app with Electron to chat with Kimi Code.');
      return;
    }

    addUserMessage(displayText);
    setLoading(true);
    try {
      if (!sessionId) {
        const sessionWorkDir = workDir || await api.getDefaultWorkDir();
        await createSession(sessionWorkDir);
      }
      await api.prompt(input.prompt);
      void loadSettings();
    } catch (error) {
      addErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [sessionId, workDir, addUserMessage, addErrorMessage, setLoading, createSession, loadSettings]);

  const cancel = useCallback(async () => {
    await window.kimiAPI?.cancel();
    finishAssistantMessage();
  }, [finishAssistantMessage]);

  return { sessionId, isLoading, sendMessage, cancel, createSession };
}

function formatApprovalPrompt(requestId: string, request: unknown): ApprovalPrompt {
  const record = asRecord(request);
  const display = asRecord(record.display);
  const summary = formatToolDisplay(display) ?? stringValue(record.action) ?? 'Approve this tool call?';
  return {
    requestId,
    toolName: stringValue(record.toolName) ?? 'Tool',
    action: stringValue(record.action) ?? summary,
    summary,
    detail: formatUnknown(display.detail ?? record.display),
  };
}

function formatToolDisplay(display: unknown): string | undefined {
  const record = asRecord(display);
  switch (record.kind) {
    case 'command':
      return [stringValue(record.command), stringValue(record.cwd)].filter(Boolean).join('\n');
    case 'file_io':
      return [stringValue(record.operation), stringValue(record.path), stringValue(record.detail)]
        .filter(Boolean)
        .join(' ');
    case 'diff':
      return `Edit ${stringValue(record.path) ?? 'file'}${typeof record.hunks === 'number' ? ` (${record.hunks} hunks)` : ''}`;
    case 'search':
      return `Search ${stringValue(record.query) ?? ''}`.trim();
    case 'url_fetch':
      return `Fetch ${stringValue(record.url) ?? 'URL'}`;
    case 'agent_call':
      return `Ask ${stringValue(record.agent_name) ?? 'agent'}: ${stringValue(record.prompt) ?? ''}`.trim();
    case 'skill_call':
      return `Use skill ${stringValue(record.skill_name) ?? ''}`.trim();
    case 'generic':
      return stringValue(record.summary);
    default:
      return undefined;
  }
}

function formatToolProgress(update: unknown): string {
  const record = asRecord(update);
  return stringValue(record.text) ?? stringValue(record.status) ?? formatUnknown(update);
}

function formatToolResult(output: unknown, isError: boolean | undefined): string {
  const content = formatUnknown(output);
  if (content.length === 0) return isError ? 'Tool failed.' : 'Tool completed.';
  return content.length > 1200 ? `${content.slice(0, 1200)}...` : content;
}

function formatUnknown(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
