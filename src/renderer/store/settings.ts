import { create } from 'zustand';
import type { PermissionMode, RuntimeSettings, SessionSummary, ThinkingLevel } from '../../preload/index';

export interface SettingsState {
  workDir: string;
  models: string[];
  selectedModel?: string;
  thinking: ThinkingLevel;
  permission: PermissionMode;
  sessions: SessionSummary[];
  isReady: boolean;
  loadSettings: () => Promise<void>;
  selectWorkDir: () => Promise<void>;
  setModel: (model: string) => Promise<void>;
  setThinking: (thinking: ThinkingLevel) => Promise<void>;
  setPermission: (permission: PermissionMode) => Promise<void>;
}

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
