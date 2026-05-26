import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';

export type PermissionMode = 'manual' | 'yolo' | 'auto';
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface RuntimeSettings {
  workDir: string;
  models: string[];
  selectedModel?: string;
  thinking: ThinkingLevel;
  permission: PermissionMode;
}

export interface SessionSummary {
  id: string;
  title?: string;
  lastPrompt?: string;
  workDir: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessageSnapshot {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: 'completed' | 'failed';
}

export interface ResumeSessionResult {
  id: string;
  workDir: string;
  messages: ChatMessageSnapshot[];
}

export interface PromptTextPart {
  type: 'text';
  text: string;
}

export interface PromptImagePart {
  type: 'image_url';
  imageUrl: { url: string; id?: string };
}

export type PromptInputPart = PromptTextPart | PromptImagePart;

export interface KimiAPI {
  getDefaultWorkDir(): Promise<string>;
  selectWorkDir(): Promise<RuntimeSettings | null>;
  setWorkDir(workDir: string): Promise<RuntimeSettings>;
  getRuntimeSettings(): Promise<RuntimeSettings>;
  updateRuntimeSettings(input: { model?: string; thinking?: ThinkingLevel; permission?: PermissionMode }): Promise<RuntimeSettings>;
  createSession(options: { workDir?: string; model?: string; thinking?: ThinkingLevel; permission?: PermissionMode }): Promise<{ id: string; workDir: string }>;
  resumeSession(id: string): Promise<ResumeSessionResult>;
  prompt(input: string | PromptInputPart[]): Promise<void>;
  cancel(): Promise<void>;
  listSessions(workDir: string): Promise<SessionSummary[]>;
  setModel(model: string): Promise<void>;
  setThinking(thinking: ThinkingLevel): Promise<void>;
  setPermission(permission: PermissionMode): Promise<void>;
  onEvent(callback: (event: unknown) => void): () => void;
  onApprovalRequest(callback: (payload: { requestId: string; request: unknown }) => void): () => void;
  respondApproval(payload: { requestId: string; response: unknown }): void;
  onQuestionRequest(callback: (payload: { requestId: string; request: unknown }) => void): () => void;
  respondQuestion(payload: { requestId: string; response: unknown }): void;
}

interface RequestPayload {
  requestId: string;
  request: unknown;
}

function isRequestPayload(value: unknown): value is RequestPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { requestId?: unknown }).requestId === 'string' &&
    'request' in value
  );
}

const api: KimiAPI = {
  getDefaultWorkDir() {
    return ipcRenderer.invoke(IPC.SYSTEM_DEFAULT_WORKDIR);
  },
  selectWorkDir() {
    return ipcRenderer.invoke(IPC.SYSTEM_SELECT_WORKDIR);
  },
  setWorkDir(workDir) {
    return ipcRenderer.invoke(IPC.SYSTEM_SET_WORKDIR, workDir);
  },
  getRuntimeSettings() {
    return ipcRenderer.invoke(IPC.CONFIG_GET);
  },
  updateRuntimeSettings(input) {
    return ipcRenderer.invoke(IPC.CONFIG_UPDATE_RUNTIME, input);
  },
  createSession(options) {
    return ipcRenderer.invoke(IPC.SESSION_CREATE, options);
  },
  resumeSession(id) {
    return ipcRenderer.invoke(IPC.SESSION_RESUME, id);
  },
  prompt(input) {
    return ipcRenderer.invoke(IPC.SESSION_PROMPT, input);
  },
  cancel() {
    return ipcRenderer.invoke(IPC.SESSION_CANCEL);
  },
  listSessions(workDir) {
    return ipcRenderer.invoke(IPC.SESSION_LIST, workDir);
  },
  setModel(model) {
    return ipcRenderer.invoke(IPC.SESSION_SET_MODEL, model);
  },
  setThinking(thinking) {
    return ipcRenderer.invoke(IPC.SESSION_SET_THINKING, thinking);
  },
  setPermission(permission) {
    return ipcRenderer.invoke(IPC.SESSION_SET_PERMISSION, permission);
  },
  onEvent(callback) {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(IPC.AGENT_EVENT, listener as any);
    return () => ipcRenderer.removeListener(IPC.AGENT_EVENT, listener as any);
  },
  onApprovalRequest(callback) {
    const listener = (_event: unknown, data: unknown) => {
      if (isRequestPayload(data)) callback(data);
    };
    ipcRenderer.on(IPC.AGENT_APPROVAL, listener as any);
    return () => ipcRenderer.removeListener(IPC.AGENT_APPROVAL, listener as any);
  },
  respondApproval(response) {
    ipcRenderer.send(IPC.AGENT_APPROVAL_RESPOND, response);
  },
  onQuestionRequest(callback) {
    const listener = (_event: unknown, data: unknown) => {
      if (isRequestPayload(data)) callback(data);
    };
    ipcRenderer.on(IPC.AGENT_QUESTION, listener as any);
    return () => ipcRenderer.removeListener(IPC.AGENT_QUESTION, listener as any);
  },
  respondQuestion(response) {
    ipcRenderer.send(IPC.AGENT_QUESTION_RESPOND, response);
  },
};

contextBridge.exposeInMainWorld('kimiAPI', api);
