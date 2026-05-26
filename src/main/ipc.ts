import { execFile } from 'node:child_process';
import { open, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainEvent, type OpenDialogOptions } from 'electron';
import { KimiHarness } from '@moonshot-ai/kimi-code-sdk';
import type { Session } from '@moonshot-ai/kimi-code-sdk';
import { IPC } from '../shared/ipc-channels';

const execFileAsync = promisify(execFile);
const MAX_PREVIEW_FILE_BYTES = 1024 * 1024;
const DEFAULT_CONFIG_MODEL = 'kimi-k2.6';
const DEFAULT_MODEL_CONTEXT_SIZE = 262144;

let harness: KimiHarness | null = null;
let activeSession: Session | null = null;
let activeSessionUnsubscribe: (() => void) | undefined;
let activeSessionChangedPaths = new Set<string>();
let targetWindow: BrowserWindow | null = null;
let handlersRegistered = false;
let requestCounter = 0;
let selectedWorkDir = process.cwd();

type PermissionMode = 'manual' | 'yolo' | 'auto';
type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

type PromptInputPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; imageUrl: { url: string; id?: string } };

interface RuntimeSettings {
  workDir: string;
  models: string[];
  selectedModel?: string;
  thinking: ThinkingLevel;
  permission: PermissionMode;
}

interface ConfigModelSettings {
  configPath: string;
  modelAlias: string;
  model: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  clearApiKey?: boolean;
  maxContextSize: number;
}

interface ChatMessageSnapshot {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: 'completed' | 'failed';
}

interface PreviewFileResult {
  path: string;
  name: string;
  content: string;
  truncated: boolean;
}

interface PreviewDiffResult {
  workDir: string;
  content: string;
}

interface ReplayContextMessage {
  role: string;
  name?: string;
  content: readonly unknown[];
  toolCalls?: readonly unknown[];
  toolCallId?: string;
  isError?: boolean;
}

type ReplayMessageRecord = { type: 'message'; message: ReplayContextMessage };
type ReplayRecord = ReplayMessageRecord | { type: string; message?: unknown };
type ReplayAgentState = {
  context?: {
    history?: readonly ReplayContextMessage[];
  };
  replay?: readonly ReplayRecord[];
};

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
  activeSessionChangedPaths = new Set();
  activeSessionUnsubscribe = session.onEvent((event: unknown) => {
    trackSessionFileChange(event);
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

function trackSessionFileChange(event: unknown): void {
  if (!isRecord(event) || event.type !== 'tool.call.started') return;

  const display = isRecord(event.display) ? event.display : {};
  const args = isRecord(event.args) ? event.args : {};
  const toolName = typeof event.name === 'string' ? event.name : '';
  const path = stringValue(display.path) ?? stringValue(args.path) ?? stringValue(args.file_path);

  if (!path) return;

  if (display.kind === 'diff') {
    activeSessionChangedPaths.add(path);
    return;
  }

  if (display.kind === 'file_io') {
    const operation = stringValue(display.operation);
    if (operation === 'write' || operation === 'edit') {
      activeSessionChangedPaths.add(path);
    }
    return;
  }

  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'StrReplace') {
    activeSessionChangedPaths.add(path);
  }
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

async function getConfigModelSettings(): Promise<ConfigModelSettings> {
  const h = getHarness();
  await h.ensureConfigFile();
  const config = await h.getConfig({ reload: true });
  const modelAlias = config.models?.[DEFAULT_CONFIG_MODEL] !== undefined
    ? DEFAULT_CONFIG_MODEL
    : config.defaultModel ?? DEFAULT_CONFIG_MODEL;
  const modelConfig = config.models?.[modelAlias];
  const provider = modelConfig?.provider ?? modelAlias;
  const providerConfig = config.providers[provider];

  return {
    configPath: h.configPath,
    modelAlias,
    model: modelConfig?.model ?? modelAlias,
    provider,
    baseUrl: providerConfig?.baseUrl ?? '',
    apiKey: '',
    hasApiKey: Boolean(providerConfig?.apiKey),
    maxContextSize: modelConfig?.maxContextSize ?? DEFAULT_MODEL_CONTEXT_SIZE,
  };
}

async function saveConfigModelSettings(input: Partial<ConfigModelSettings>): Promise<ConfigModelSettings> {
  const h = getHarness();
  await h.ensureConfigFile();
  const modelAlias = normalizeRequiredText(input.modelAlias, 'Model alias');
  const provider = normalizeRequiredText(input.provider, 'Provider');
  const model = normalizeRequiredText(input.model, 'Model');
  const maxContextSize = normalizePositiveInteger(input.maxContextSize, 'Max context size');
  const baseUrl = input.baseUrl?.trim() ?? '';
  const existing = await h.getConfig({ reload: true });
  const previousApiKey = existing.providers[provider]?.apiKey ?? '';
  const apiKey = input.clearApiKey === true
    ? ''
    : typeof input.apiKey === 'string' && input.apiKey.length > 0
      ? input.apiKey
      : previousApiKey;

  await h.setConfig({
    defaultModel: modelAlias,
    providers: {
      [provider]: {
        type: 'kimi',
        baseUrl,
        apiKey,
        defaultModel: model,
      },
    },
    models: {
      [modelAlias]: {
        provider,
        model,
        maxContextSize,
      },
    },
  });

  await activeSession?.setModel(modelAlias);
  return getConfigModelSettings();
}

function normalizeRequiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function normalizePositiveInteger(value: unknown, label: string): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return numberValue;
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

  ipcMain.handle(IPC.CONFIG_MODEL_GET, async () => getConfigModelSettings());

  ipcMain.handle(IPC.CONFIG_MODEL_SAVE, async (_event, input: Partial<ConfigModelSettings>) => {
    const settings = await saveConfigModelSettings(input);
    return {
      settings,
      runtime: await getRuntimeSettings(),
    };
  });

  ipcMain.handle(IPC.CONFIG_OPEN_FILE, async () => {
    const h = getHarness();
    await h.ensureConfigFile();
    const error = await shell.openPath(h.configPath);
    if (error) {
      throw new Error(error);
    }
    return h.configPath;
  });

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

  ipcMain.handle(IPC.SESSION_PROMPT, async (_event, input: string | PromptInputPart[]) => {
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

  ipcMain.handle(IPC.PREVIEW_SELECT_FILE, async () => selectPreviewFile());
  ipcMain.handle(IPC.PREVIEW_GIT_DIFF, async () => getGitDiffPreview());
}

async function selectPreviewFile(): Promise<PreviewFileResult | null> {
  const options: OpenDialogOptions = {
    title: '选择要预览的文件',
    defaultPath: selectedWorkDir,
    properties: ['openFile'],
  };
  const result = targetWindow === null
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(targetWindow, options);
  const filePath = result.filePaths[0];
  if (result.canceled || filePath === undefined) return null;

  const fileStat = await stat(filePath);
  const bytesToRead = Math.min(fileStat.size, MAX_PREVIEW_FILE_BYTES);
  const file = await open(filePath, 'r');
  let content = '';
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const result = await file.read(buffer, 0, bytesToRead, 0);
    content = buffer.subarray(0, result.bytesRead).toString('utf-8');
  } finally {
    await file.close();
  }
  return {
    path: filePath,
    name: basename(filePath),
    content,
    truncated: fileStat.size > MAX_PREVIEW_FILE_BYTES,
  };
}

async function getGitDiffPreview(): Promise<PreviewDiffResult> {
  const changedPaths = Array.from(activeSessionChangedPaths);
  if (changedPaths.length === 0) {
    return {
      workDir: selectedWorkDir,
      content: '',
    };
  }

  try {
    const { stdout } = await execFileAsync('git', ['-C', selectedWorkDir, 'diff', '--no-ext-diff', '--', ...changedPaths], {
      maxBuffer: 1024 * 1024 * 8,
    });
    return {
      workDir: selectedWorkDir,
      content: stdout.trim().length > 0 ? stdout : '',
    };
  } catch (error) {
    return {
      workDir: selectedWorkDir,
      content: `无法读取 Git diff：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function replayMessages(session: Session): ChatMessageSnapshot[] {
  const state = session.getResumeState();
  const agent = getReplayAgentState(state);
  const replay = agent?.replay ?? [];
  const replayedMessages = replay
    .filter(isReplayMessageRecord)
    .map((record) => record.message);
  const history = agent?.context?.history ?? [];
  const source = replayedMessages.length > 0 ? replayedMessages : history;
  return source.flatMap((message, index) => formatReplayMessage(message, index));
}

function isReplayMessageRecord(record: ReplayRecord): record is ReplayMessageRecord {
  return record.type === 'message' && isRecord(record.message);
}

function getReplayAgentState(state: ReturnType<Session['getResumeState']>): ReplayAgentState | undefined {
  const agents = state?.agents;
  if (!agents) return undefined;
  return (agents['main'] ?? Object.values(agents)[0]) as ReplayAgentState | undefined;
}

function formatReplayMessage(message: ReplayContextMessage, index: number): ChatMessageSnapshot[] {
  const content = formatContent(message.content);
  const toolCallSummary = formatToolCalls(message.toolCalls ?? []);
  const fallback = toolCallSummary ?? (message.role === 'tool' ? 'Tool completed.' : '');
  if (content.length === 0 && fallback.length === 0) return [];

  if (message.role === 'user' || message.role === 'assistant') {
    return [{
      id: `replay-${index}`,
      role: message.role,
      content: content || fallback,
    }];
  }

  if (message.role === 'tool') {
    return [{
      id: `replay-${index}`,
      role: 'tool',
      toolName: message.name ?? 'Tool',
      toolCallId: message.toolCallId,
      toolStatus: message.isError === true ? 'failed' : 'completed',
      content: content || fallback,
    }];
  }

  return [{
    id: `replay-${index}`,
    role: 'tool',
    toolName: 'System',
    toolStatus: 'completed',
    content: content || fallback,
  }];
}

function formatContent(content: readonly unknown[] | string): string {
  if (typeof content === 'string') return content;
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

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
