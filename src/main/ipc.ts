import { dialog, ipcMain, type BrowserWindow, type IpcMainEvent, type OpenDialogOptions } from 'electron';
import { KimiHarness } from '@moonshot-ai/kimi-code-sdk';
import type { Session } from '@moonshot-ai/kimi-code-sdk';
import { IPC } from '../shared/ipc-channels';

let harness: KimiHarness | null = null;
let activeSession: Session | null = null;
let activeSessionUnsubscribe: (() => void) | undefined;
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

interface ChatMessageSnapshot {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: 'completed' | 'failed';
}

interface ReplayContextMessage {
  role: string;
  name?: string;
  content: readonly unknown[];
  toolCalls: readonly unknown[];
  toolCallId?: string;
  isError?: boolean;
}

type ReplayMessageRecord = { type: 'message'; message: ReplayContextMessage };
type ReplayRecord = ReplayMessageRecord | { type: string; message?: unknown };

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

function attachSession(session: Session): void {
  activeSessionUnsubscribe?.();
  activeSessionUnsubscribe = session.onEvent((event: unknown) => {
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

  activeSession = session;
  selectedWorkDir = session.workDir;
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
  for (const provider of Object.values(config.providers) as Array<{ defaultModel?: string }>) {
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
    const options: OpenDialogOptions = {
      title: '选择工作区',
      defaultPath: selectedWorkDir,
      properties: ['openDirectory'],
    };
    const result = targetWindow === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(targetWindow, options);
    if (result.canceled || result.filePaths[0] === undefined) {
      return null;
    }
    selectedWorkDir = result.filePaths[0];
    return getRuntimeSettings();
  });

  ipcMain.handle(IPC.SYSTEM_SET_WORKDIR, async (_event, workDir: string) => {
    const normalized = workDir.trim();
    if (normalized.length > 0) {
      selectedWorkDir = normalized;
    }
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

    attachSession(session);

    return { id: session.id, workDir: session.workDir };
  });

  ipcMain.handle(IPC.SESSION_RESUME, async (_event, id: string) => {
    const h = getHarness();
    const session = await h.resumeSession({ id });
    attachSession(session);
    return { id: session.id, workDir: session.workDir, messages: replayMessages(session) };
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

function replayMessages(session: Session): ChatMessageSnapshot[] {
  const state = session.getResumeState();
  const replay = (state?.agents['main']?.replay ?? []) as readonly ReplayRecord[];
  const messages: ChatMessageSnapshot[] = [];
  replay.forEach((record, index) => {
    if (!isReplayMessageRecord(record)) return;
    const message = record.message;
    const content = formatContent(message.content);
    const toolCallSummary = formatToolCalls(message.toolCalls);
    const fallback = toolCallSummary ?? (message.role === 'tool' ? 'Tool completed.' : '');
    if (content.length === 0 && fallback.length === 0) return;
    if (message.role === 'user' || message.role === 'assistant') {
      messages.push({
        id: `replay-${index}`,
        role: message.role,
        content: content || fallback,
      });
      return;
    }
    if (message.role === 'tool') {
      messages.push({
        id: `replay-${index}`,
        role: 'tool',
        toolName: message.name ?? 'Tool',
        toolCallId: message.toolCallId,
        toolStatus: message.isError === true ? 'failed' : 'completed',
        content: content || fallback,
      });
      return;
    }
    messages.push({
      id: `replay-${index}`,
      role: 'tool',
      toolName: 'System',
      toolStatus: 'completed',
      content: content || fallback,
    });
  });
  return messages;
}

function isReplayMessageRecord(record: ReplayRecord): record is ReplayMessageRecord {
  return record.type === 'message' && isRecord(record.message);
}

function formatContent(content: readonly unknown[]): string {
  return content
    .map((part) => {
      if (!isRecord(part)) return '';
      switch (part.type) {
        case 'text':
          return typeof part.text === 'string' ? part.text : '';
        case 'think':
          return typeof part.think === 'string' ? `思考：${part.think}` : '';
        case 'image_url':
          return '[图片]';
        case 'audio_url':
          return '[音频]';
        case 'video_url':
          return '[视频]';
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

function formatToolCalls(toolCalls: readonly unknown[]): string | undefined {
  if (toolCalls.length === 0) return undefined;
  const names = toolCalls
    .map((toolCall) => {
      if (!isRecord(toolCall)) return undefined;
      const fn = toolCall.function;
      if (!isRecord(fn)) return undefined;
      return typeof fn.name === 'string' ? fn.name : undefined;
    })
    .filter((name): name is string => name !== undefined);
  return names.length > 0 ? `调用工具：${names.join(', ')}` : '调用工具';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
