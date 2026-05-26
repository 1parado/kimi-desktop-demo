import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';

export interface KimiAPI {
  getDefaultWorkDir(): Promise<string>;
  createSession(options: { workDir?: string; model?: string }): Promise<{ id: string; workDir: string }>;
  prompt(input: string): Promise<void>;
  cancel(): Promise<void>;
  listSessions(workDir: string): Promise<unknown[]>;
  onEvent(callback: (event: unknown) => void): () => void;
  onApprovalRequest(callback: (request: unknown) => void): () => void;
  respondApproval(response: unknown): void;
  onQuestionRequest(callback: (request: unknown) => void): () => void;
  respondQuestion(response: unknown): void;
}

const api: KimiAPI = {
  getDefaultWorkDir() {
    return ipcRenderer.invoke(IPC.SYSTEM_DEFAULT_WORKDIR);
  },
  createSession(options) {
    return ipcRenderer.invoke(IPC.SESSION_CREATE, options);
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
  onEvent(callback) {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(IPC.AGENT_EVENT, listener as any);
    return () => ipcRenderer.removeListener(IPC.AGENT_EVENT, listener as any);
  },
  onApprovalRequest(callback) {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(IPC.AGENT_APPROVAL, listener as any);
    return () => ipcRenderer.removeListener(IPC.AGENT_APPROVAL, listener as any);
  },
  respondApproval(response) {
    ipcRenderer.send(IPC.AGENT_APPROVAL_RESPOND, response);
  },
  onQuestionRequest(callback) {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on(IPC.AGENT_QUESTION, listener as any);
    return () => ipcRenderer.removeListener(IPC.AGENT_QUESTION, listener as any);
  },
  respondQuestion(response) {
    ipcRenderer.send(IPC.AGENT_QUESTION_RESPOND, response);
  },
};

contextBridge.exposeInMainWorld('kimiAPI', api);
