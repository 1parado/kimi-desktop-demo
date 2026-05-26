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
  sessionMessages: Record<string, Message[]>;
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
  startNewSession: (id: string) => void;
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

function isSessionNotice(message: Message): boolean {
  return message.role === 'tool' &&
    message.toolName === 'Session' &&
    message.toolStatus === 'completed' &&
    message.content.startsWith('已切换到会话：');
}

function cacheCurrentSession(state: ChatState): Record<string, Message[]> {
  if (!state.sessionId) return state.sessionMessages;
  if (state.messages.length === 1 && isSessionNotice(state.messages[0]!)) {
    return state.sessionMessages;
  }
  return {
    ...state.sessionMessages,
    [state.sessionId]: state.messages,
  };
}

function cacheMessages(state: ChatState, messages: Message[]): Record<string, Message[]> {
  if (!state.sessionId) return state.sessionMessages;
  return {
    ...state.sessionMessages,
    [state.sessionId]: messages,
  };
}

function createSessionNotice(title: string): Message {
  return {
    id: nextId(),
    role: 'tool',
    toolName: 'Session',
    toolStatus: 'completed',
    content: `已切换到会话：${title}`,
  };
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  messages: [],
  sessionMessages: {},
  isLoading: false,
  pendingApproval: null,

  addUserMessage(content) {
    set((state) => {
      const messages = [...state.messages, { id: nextId(), role: 'user', content } satisfies Message];
      return {
        messages,
        sessionMessages: cacheMessages(state, messages),
      };
    });
  },

  startAssistantMessage() {
    set((state) => {
      const messages = [
        ...state.messages,
        { id: nextId(), role: 'assistant', content: '', isStreaming: true } satisfies Message,
      ];
      return {
        messages,
        sessionMessages: cacheMessages(state, messages),
      };
    });
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
      return {
        messages,
        sessionMessages: cacheMessages(state, messages),
      };
    });
  },

  finishAssistantMessage() {
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant') {
        messages[messages.length - 1] = { ...last, isStreaming: false };
      }
      return {
        messages,
        sessionMessages: cacheMessages(state, messages),
        isLoading: false,
      };
    });
  },

  startToolMessage(toolCallId, toolName, content) {
    set((state) => {
      const messages = upsertTool(
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
      );
      return {
        messages,
        sessionMessages: cacheMessages(state, messages),
      };
    });
  },

  updateToolMessage(toolCallId, content) {
    set((state) => {
      const messages = upsertTool(
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
      );
      return {
        messages,
        sessionMessages: cacheMessages(state, messages),
      };
    });
  },

  finishToolMessage(toolCallId, status, content) {
    set((state) => {
      const messages = upsertTool(
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
      );
      return {
        messages,
        sessionMessages: cacheMessages(state, messages),
      };
    });
  },

  addErrorMessage(content) {
    set((state) => {
      const messages = [
        ...state.messages,
        { id: nextId(), role: 'tool', toolName: 'Error', toolStatus: 'failed', content } satisfies Message,
      ];
      return {
        messages,
        sessionMessages: cacheMessages(state, messages),
        isLoading: false,
      };
    });
  },

  setPendingApproval(approval) {
    set({ pendingApproval: approval });
  },

  setSessionId(id) {
    set((state) => {
      const sessionMessages = cacheCurrentSession(state);
      return {
        sessionId: id,
        sessionMessages: {
          ...sessionMessages,
          [id]: sessionMessages[id] ?? state.messages,
        },
      };
    });
  },

  startNewSession(id) {
    set((state) => ({
      sessionId: id,
      sessionMessages: cacheCurrentSession(state),
      messages: state.sessionMessages[id] ?? [],
      isLoading: false,
      pendingApproval: null,
    }));
  },

  switchSession(id, title, messages) {
    set((state) => {
      const sessionMessages = cacheCurrentSession(state);
      const cachedMessages = sessionMessages[id] ?? [];
      const nextMessages = messages.length > 0
        ? messages
        : cachedMessages.length > 0
          ? cachedMessages
          : [createSessionNotice(title)];
      return {
        sessionId: id,
        sessionMessages: {
          ...sessionMessages,
          [id]: nextMessages,
        },
        messages: nextMessages,
        isLoading: false,
        pendingApproval: null,
      };
    });
  },

  setLoading(loading) {
    set({ isLoading: loading });
  },

  clearMessages() {
    set((state) => ({
      messages: [],
      sessionId: null,
      sessionMessages: cacheCurrentSession(state),
      pendingApproval: null,
    }));
  },
}));
