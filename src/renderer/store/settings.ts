import { create } from 'zustand';
import type { PermissionMode, RuntimeSettings, SessionSummary, ThinkingLevel } from '../../preload/index';

export interface SettingsState {
  workDir: string;
  models: string[];
  selectedModel?: string;
  thinking: ThinkingLevel;
  permission: PermissionMode;
  sessions: SessionSummary[];
  pinnedSessionIds: string[];
  isReady: boolean;
  loadSettings: () => Promise<void>;
  selectWorkDir: () => Promise<void>;
  setWorkDir: (workDir: string) => Promise<void>;
  togglePinnedSession: (sessionId: string) => void;
  setModel: (model: string) => Promise<void>;
  setThinking: (thinking: ThinkingLevel) => Promise<void>;
  setPermission: (permission: PermissionMode) => Promise<void>;
}

const PINNED_SESSIONS_KEY = 'kimi-desktop:pinned-session-ids';

function applySettings(settings: RuntimeSettings) {
  return {
    workDir: settings.workDir,
    models: settings.models,
    selectedModel: settings.selectedModel,
    thinking: settings.thinking,
    permission: settings.permission,
    isReady: true,
  };
}

export const useSettingsStore = create<SettingsState>((set) => ({
  workDir: '',
  models: [],
  selectedModel: undefined,
  thinking: 'high',
  permission: 'manual',
  sessions: [],
  pinnedSessionIds: readPinnedSessionIds(),
  isReady: false,

  async loadSettings() {
    const api = window.kimiAPI;
    if (!api) return;
    const settings = await api.getRuntimeSettings();
    const sessions = await api.listSessions(settings.workDir);
    set({ ...applySettings(settings), sessions });
  },

  async selectWorkDir() {
    const api = window.kimiAPI;
    if (!api) return;
    const settings = await api.selectWorkDir();
    if (!settings) return;
    const sessions = await api.listSessions(settings.workDir);
    set({ ...applySettings(settings), sessions });
  },

  async setWorkDir(workDir) {
    const api = window.kimiAPI;
    if (!api) return;
    const settings = await api.setWorkDir(workDir);
    const sessions = await api.listSessions(settings.workDir);
    set({ ...applySettings(settings), sessions });
  },

  togglePinnedSession(sessionId) {
    set((state) => {
      const pinned = state.pinnedSessionIds.includes(sessionId)
        ? state.pinnedSessionIds.filter((id) => id !== sessionId)
        : [...state.pinnedSessionIds, sessionId];
      writePinnedSessionIds(pinned);
      return { pinnedSessionIds: pinned };
    });
  },

  async setModel(model) {
    const api = window.kimiAPI;
    if (!api) return;
    set({ selectedModel: model });
    const settings = await api.updateRuntimeSettings({ model });
    set(applySettings(settings));
  },

  async setThinking(thinking) {
    const api = window.kimiAPI;
    if (!api) return;
    set({ thinking });
    const settings = await api.updateRuntimeSettings({ thinking });
    set(applySettings(settings));
  },

  async setPermission(permission) {
    const api = window.kimiAPI;
    if (!api) return;
    set({ permission });
    const settings = await api.updateRuntimeSettings({ permission });
    set(applySettings(settings));
  },
}));

function readPinnedSessionIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PINNED_SESSIONS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

function writePinnedSessionIds(ids: string[]): void {
  localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(ids));
}
