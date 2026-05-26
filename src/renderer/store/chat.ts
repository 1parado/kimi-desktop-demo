import { create } from 'zustand';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  isStreaming?: boolean;
}

export interface ChatState {
  sessionId: string | null;
  messages: Message[];
  isLoading: boolean;
  addUserMessage: (content: string) => void;
  appendAssistantDelta: (delta: string) => void;
  startAssistantMessage: () => void;
  finishAssistantMessage: () => void;
  addToolMessage: (toolName: string, content: string) => void;
  addErrorMessage: (content: string) => void;
  setSessionId: (id: string) => void;
  setLoading: (loading: boolean) => void;
  clearMessages: () => void;
}

let messageCounter = 0;
function nextId(): string {
  return `msg-${++messageCounter}-${Date.now()}`;
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  messages: [],
  isLoading: false,

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

  addToolMessage(toolName, content) {
    set((state) => ({
      messages: [...state.messages, { id: nextId(), role: 'tool', toolName, content }],
    }));
  },

  addErrorMessage(content) {
    set((state) => ({
      messages: [...state.messages, { id: nextId(), role: 'tool', toolName: 'Error', content }],
      isLoading: false,
    }));
  },

  setSessionId(id) {
    set({ sessionId: id });
  },

  setLoading(loading) {
    set({ isLoading: loading });
  },

  clearMessages() {
    set({ messages: [], sessionId: null });
  },
}));
