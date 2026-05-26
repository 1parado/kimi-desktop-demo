import { dialog, ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron';
import { KimiHarness } from '@moonshot-ai/kimi-code-sdk';
import type { Session } from '@moonshot-ai/kimi-code-sdk';
import { IPC } from '../shared/ipc-channels';

let harness: KimiHarness | null = null;
let activeSession: Session | null = null;
let targetWindow: BrowserWindow | null = null;
let handlersRegistered = false;
let requestCounter = 0;
let selectedWorkDir = process.cwd();

type PermissionMode = 'manual' | 'yolo' | 'auto';
type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

interface RuntimeSettings {
  workDir: string;
  models: string[];
  selectedModel?: string;
  thinking: ThinkingLevel;
  permission: PermissionMode;
}

function getHarness(): KimiHarness {
  if (!harness) {
    harness = new KimiHarness({});
  }
  return harness;
}

function nextRequestId(): string {
  requestCounter += 1;
  return `request-${Date.now()}-${requestCounter}`;
}

function sendToRenderer(channel: string, payload: unknown): boolean {
  if (!targetWindow || targetWindow.isDestroyed()) return false;
  targetWindow.webContents.send(channel, payload);
  return true;
}

function waitForRendererResponse<TResponse>(
  channel: string,
  requestId: string,
  fallback: TResponse,
): Promise<TResponse> {
  return new Promise((resolve) => {
    const listener = (_event: IpcMainEvent, payload: unknown) => {
      if (
        typeof payload !== 'object' ||
        payload === null ||
        (payload as { requestId?: unknown }).requestId !== requestId
      ) {
        return;
      }

      ipcMain.removeListener(channel, listener);
      resolve((payload as { response?: TResponse }).response ?? fallback);
    };

    ipcMain.on(channel, listener);
  });
}

function normalizePermission(value: unknown): PermissionMode {
  return value === 'manual' || value === 'yolo' || value === 'auto' ? value : 'manual';
}

function normalizeThinking(value: unknown): ThinkingLevel {
  return value === 'off' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
    ? value
    : 'high';
}

async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const h = getHarness();
  await h.ensureConfigFile();
  const config = await h.getConfig({ reload: true });
  const models = new Set<string>();

  if (config.defaultModel) {
    models.add(config.defaultModel);
  }
  for (const name of Object.keys(config.models ?? {})) {
    models.add(name);
  }
  for (const provider of Object.values(config.providers)) {
    if (provider.defaultModel) {
      models.add(provider.defaultModel);
    }
  }

  const thinking = config.thinking?.mode === 'off'
    ? 'off'
    : normalizeThinking(config.thinking?.effort ?? (config.defaultThinking === false ? 'off' : 'high'));

  return {
    workDir: selectedWorkDir,
    models: Array.from(models).sort(),
    selectedModel: config.defaultModel,
    thinking,
    permission: normalizePermission(config.defaultPermissionMode),
  };
}

export function registerIpcHandlers(win: BrowserWindow): void {
  targetWindow = win;
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle(IPC.SYSTEM_DEFAULT_WORKDIR, async () => selectedWorkDir);

  ipcMain.handle(IPC.SYSTEM_SELECT_WORKDIR, async () => {
    const result = await dialog.showOpenDialog(targetWindow ?? undefined, {
      title: '选择工作区',
      defaultPath: selectedWorkDir,
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths[0] === undefined) {
      return null;
    }
    selectedWorkDir = result.filePaths[0];
    return getRuntimeSettings();
  });

  ipcMain.handle(IPC.CONFIG_GET, async () => getRuntimeSettings());

  ipcMain.handle(
    IPC.CONFIG_UPDATE_RUNTIME,
    async (_event, input: { model?: string; thinking?: ThinkingLevel; permission?: PermissionMode }) => {
      const h = getHarness();
      const patch: Record<string, unknown> = {};
      const model = input.model?.trim();
      if (model) {
        patch.defaultModel = model;
        await activeSession?.setModel(model);
      }
      if (input.thinking !== undefined) {
        patch.thinking = input.thinking === 'off' ? { mode: 'off' } : { mode: 'on', effort: input.thinking };
        await activeSession?.setThinking(input.thinking);
      }
      if (input.permission !== undefined) {
        patch.defaultPermissionMode = input.permission;
        await activeSession?.setPermission(input.permission);
      }
      if (Object.keys(patch).length > 0) {
        await h.setConfig(patch);
      }
      return getRuntimeSettings();
    },
  );

  ipcMain.handle(IPC.SESSION_CREATE, async (_event, options: { workDir?: string; model?: string; thinking?: ThinkingLevel; permission?: PermissionMode }) => {
    const h = getHarness();
    await h.ensureConfigFile();
    const config = await h.getConfig();
    const model = options.model ?? config.defaultModel;
    if (!model) {
      throw new Error('No model configured. Set default_model in config.toml.');
    }

    const session = await h.createSession({
      workDir: options.workDir?.trim() || selectedWorkDir,
      model,
      thinking: options.thinking,
      permission: options.permission ?? normalizePermission(config.defaultPermissionMode),
    });

    activeSession = session;

    session.onEvent((event: unknown) => {
      sendToRenderer(IPC.AGENT_EVENT, event);
    });

    session.setApprovalHandler(async (request: unknown) => {
      const requestId = nextRequestId();
      const sent = sendToRenderer(IPC.AGENT_APPROVAL, { requestId, request });
      if (!sent) {
        return { decision: 'cancelled', feedback: 'No renderer is available for approval.' };
      }
      return waitForRendererResponse(IPC.AGENT_APPROVAL_RESPOND, requestId, {
        decision: 'cancelled',
        feedback: 'Approval request was cancelled.',
      });
    });

    session.setQuestionHandler(async (request: unknown) => {
      const requestId = nextRequestId();
      const sent = sendToRenderer(IPC.AGENT_QUESTION, { requestId, request });
      if (!sent) return null;
      return waitForRendererResponse(IPC.AGENT_QUESTION_RESPOND, requestId, null);
    });

    return { id: session.id, workDir: session.workDir };
  });

  ipcMain.handle(IPC.SESSION_PROMPT, async (_event, input: string) => {
    if (!activeSession) throw new Error('No active session');
    await activeSession.prompt(input);
  });

  ipcMain.handle(IPC.SESSION_CANCEL, async () => {
    if (!activeSession) return;
    await activeSession.cancel();
  });

  ipcMain.handle(IPC.SESSION_SET_MODEL, async (_event, model: string) => {
    if (!activeSession) return;
    await activeSession.setModel(model);
  });

  ipcMain.handle(IPC.SESSION_SET_THINKING, async (_event, thinking: string) => {
    if (!activeSession) return;
    await activeSession.setThinking(thinking);
  });

  ipcMain.handle(IPC.SESSION_SET_PERMISSION, async (_event, permission: PermissionMode) => {
    if (!activeSession) return;
    await activeSession.setPermission(permission);
  });

  ipcMain.handle(IPC.SESSION_LIST, async (_event, workDir: string) => {
    const h = getHarness();
    return h.listSessions({ workDir });
  });
}
