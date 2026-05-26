import { create } from 'zustand';

export type ToolStatus = 'running' | 'completed' | 'failed';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: ToolStatus;
  isStreaming?: boolean;
}

export interface ApprovalPrompt {
  requestId: string;
  toolName: string;
  action: string;
  summary: string;
  detail?: string;
}

export interface ChatState {
  sessionId: string | null;
  messages: Message[];
  isLoading: boolean;
  pendingApproval: ApprovalPrompt | null;
  addUserMessage: (content: string) => void;
  appendAssistantDelta: (delta: string) => void;
  startAssistantMessage: () => void;
  finishAssistantMessage: () => void;
  startToolMessage: (toolCallId: string, toolName: string, content: string) => void;
  updateToolMessage: (toolCallId: string, content: string) => void;
  finishToolMessage: (toolCallId: string, status: Exclude<ToolStatus, 'running'>, content?: string) => void;
  addErrorMessage: (content: string) => void;
  setPendingApproval: (approval: ApprovalPrompt | null) => void;
  setSessionId: (id: string) => void;
  switchSession: (id: string, title: string, messages: Message[]) => void;
  setLoading: (loading: boolean) => void;
  clearMessages: () => void;
}

let messageCounter = 0;
function nextId(): string {
  return `msg-${++messageCounter}-${Date.now()}`;
}

function upsertTool(
  messages: Message[],
  toolCallId: string,
  createMessage: () => Message,
  updateMessage: (message: Message) => Message,
): Message[] {
  const index = messages.findIndex((message) => message.toolCallId === toolCallId);
  if (index === -1) {
    return [...messages, createMessage()];
  }

  const next = [...messages];
  next[index] = updateMessage(next[index]!);
  return next;
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  messages: [],
  isLoading: false,
  pendingApproval: null,

  addUserMessage(content) {
    set((state) => ({
      messages: [...state.messages, { id: nextId(), role: 'user', content }],
    }));
  },

  startAssistantMessage() {
    set((state) => ({
      messages: [...state.messages, { id: nextId(), role: 'assistant', content: '', isStreaming: true }],
    }));
  },

  appendAssistantDelta(delta) {
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant' && last.isStreaming) {
        messages[messages.length - 1] = { ...last, content: last.content + delta };
      } else {
        messages.push({ id: nextId(), role: 'assistant', content: delta, isStreaming: true });
      }
      return { messages };
    });
  },

  finishAssistantMessage() {
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant') {
        messages[messages.length - 1] = { ...last, isStreaming: false };
      }
      return { messages, isLoading: false };
    });
  },

  startToolMessage(toolCallId, toolName, content) {
    set((state) => ({
      messages: upsertTool(
        state.messages,
        toolCallId,
        () => ({
          id: nextId(),
          role: 'tool',
          toolCallId,
          toolName,
          toolStatus: 'running',
          content,
        }),
        (message) => ({ ...message, toolName, toolStatus: 'running', content }),
      ),
    }));
  },

  updateToolMessage(toolCallId, content) {
    set((state) => ({
      messages: upsertTool(
        state.messages,
        toolCallId,
        () => ({
          id: nextId(),
          role: 'tool',
          toolCallId,
          toolName: 'Tool',
          toolStatus: 'running',
          content,
        }),
        (message) => ({ ...message, content, toolStatus: 'running' }),
      ),
    }));
  },

  finishToolMessage(toolCallId, status, content) {
    set((state) => ({
      messages: upsertTool(
        state.messages,
        toolCallId,
        () => ({
          id: nextId(),
          role: 'tool',
          toolCallId,
          toolName: 'Tool',
          toolStatus: status,
          content: content ?? (status === 'failed' ? 'Tool failed.' : 'Tool completed.'),
        }),
        (message) => ({
          ...message,
          toolStatus: status,
          content: content ?? message.content,
        }),
      ),
    }));
  },

  addErrorMessage(content) {
    set((state) => ({
      messages: [...state.messages, { id: nextId(), role: 'tool', toolName: 'Error', toolStatus: 'failed', content }],
      isLoading: false,
    }));
  },

  setPendingApproval(approval) {
    set({ pendingApproval: approval });
  },

  setSessionId(id) {
    set({ sessionId: id });
  },

  switchSession(id, title, messages) {
    set({
      sessionId: id,
      messages: messages.length > 0 ? messages : [{
        id: nextId(),
        role: 'tool',
        toolName: 'Session',
        toolStatus: 'completed',
        content: `已切换到会话：${title}`,
      }],
      isLoading: false,
      pendingApproval: null,
    });
  },

  setLoading(loading) {
    set({ isLoading: loading });
  },

  clearMessages() {
    set({ messages: [], sessionId: null, pendingApproval: null });
  },
}));
