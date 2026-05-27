import { execFile } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { app, dialog, ipcMain, net, shell, type BrowserWindow, type IpcMainEvent, type OpenDialogOptions } from 'electron';
import { KimiHarness } from '@moonshot-ai/kimi-code-sdk';
import type { Session } from '@moonshot-ai/kimi-code-sdk';
import { IPC } from '../shared/ipc-channels';
import type {
  MessagingProviderId,
  MessagingSettings,
  SaveMessagingSettingsResult,
  TestMessagingInput,
  TestMessagingResult,
} from '../shared/messaging';
import {
  BUILTIN_SLASH_COMMANDS,
  findSlashCommand,
  parseSlashInput,
  sortSlashCommands,
  type SlashCommandInfo,
  type SlashCommandResult,
} from '../shared/slash-commands';

const execFileAsync = promisify(execFile);
const MAX_PREVIEW_FILE_BYTES = 1024 * 1024;
const DEFAULT_CONFIG_MODEL = 'kimi-k2.6';
const DEFAULT_MODEL_CONTEXT_SIZE = 262144;
const DEFAULT_OAUTH_PROVIDER_NAME = 'managed:kimi-code';
const FEEDBACK_ISSUE_URL = 'https://github.com/MoonshotAI/kimi-code/issues';
const MESSAGING_SETTINGS_FILE = 'messaging-integrations.json';
const TELEGRAM_CONTROL_DEFAULT_PORT = 8787;
const TELEGRAM_MESSAGE_LIMIT = 3900;
const DEFAULT_MESSAGING_SETTINGS: PrivateMessagingSettings = {
  notifyOnTurnEnd: true,
  notifyOnError: true,
  telegram: {
    enabled: false,
    controlEnabled: false,
    chatId: '',
    botToken: '',
    webhookBaseUrl: '',
    webhookSecret: '',
    localWebhookPort: TELEGRAM_CONTROL_DEFAULT_PORT,
  },
  feishu: {
    enabled: false,
    webhookUrl: '',
    secret: '',
  },
};

let harness: KimiHarness | null = null;
let activeSession: Session | null = null;
let activeSessionUnsubscribe: (() => void) | undefined;
let activeSessionChangedPaths = new Set<string>();
let targetWindow: BrowserWindow | null = null;
let handlersRegistered = false;
let requestCounter = 0;
let selectedWorkDir = process.cwd();
let telegramControlServer: Server | undefined;
let telegramControlServerPort: number | undefined;
let telegramControlPromptQueue = Promise.resolve();
let telegramTurnCapture: {
  chatId: string;
  chunks: string[];
  resolve: () => void;
  reject: (error: Error) => void;
} | undefined;

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

interface SkillSummaryLike {
  name?: unknown;
  description?: unknown;
  type?: unknown;
}

interface PrivateMessagingSettings {
  notifyOnTurnEnd: boolean;
  notifyOnError: boolean;
  telegram: {
    enabled: boolean;
    controlEnabled: boolean;
    chatId: string;
    botToken: string;
    webhookBaseUrl: string;
    webhookSecret: string;
    localWebhookPort: number;
  };
  feishu: {
    enabled: boolean;
    webhookUrl: string;
    secret: string;
  };
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
    void captureTelegramControlEvent(event).catch(() => undefined);
    void notifyMessagingEvent(event).catch(() => undefined);
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
  void syncTelegramControlFromSettings().catch(() => undefined);
  app.on('before-quit', () => {
    void stopTelegramControlServer();
  });

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

  ipcMain.handle(IPC.MESSAGING_GET, async () => getMessagingSettings());

  ipcMain.handle(IPC.MESSAGING_SAVE, async (_event, input: MessagingSettings): Promise<SaveMessagingSettingsResult> => {
    const settings = await saveMessagingSettings(input);
    return { settings };
  });

  ipcMain.handle(IPC.MESSAGING_TEST, async (_event, input: TestMessagingInput): Promise<TestMessagingResult> => {
    const provider = normalizeMessagingProvider(input.provider);
    const message = typeof input.message === 'string' && input.message.trim().length > 0
      ? input.message.trim()
      : 'Kimi Desktop messaging integration test.';
    await sendMessagingProvider(provider, message);
    return { ok: true, message: '测试消息已发送' };
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

  ipcMain.handle(IPC.SESSION_PROMPT, async (_event, input: string | PromptInputPart[]): Promise<SlashCommandResult> => {
    if (!activeSession) throw new Error('No active session');
    const commandInput = extractSlashCommandText(input);
    if (commandInput !== undefined) {
      const result = await executeSlashCommand(commandInput);
      if (result.handled) return result;
    }
    await activeSession.prompt(input);
    return { handled: false, startsTurn: true };
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

  ipcMain.handle(IPC.SESSION_SLASH_COMMANDS, async () => listSlashCommands());

  ipcMain.handle(IPC.PREVIEW_SELECT_FILE, async () => selectPreviewFile());
  ipcMain.handle(IPC.PREVIEW_GIT_DIFF, async () => getGitDiffPreview());
}

function messagingSettingsPath(): string {
  return join(app.getPath('userData'), MESSAGING_SETTINGS_FILE);
}

async function readPrivateMessagingSettings(): Promise<PrivateMessagingSettings> {
  try {
    const raw = await readFile(messagingSettingsPath(), 'utf-8');
    return normalizePrivateMessagingSettings(JSON.parse(raw));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return cloneDefaultMessagingSettings();
    }
    throw error;
  }
}

async function writePrivateMessagingSettings(settings: PrivateMessagingSettings): Promise<void> {
  const path = messagingSettingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
}

async function getMessagingSettings(): Promise<MessagingSettings> {
  return toPublicMessagingSettings(await readPrivateMessagingSettings());
}

async function saveMessagingSettings(input: MessagingSettings): Promise<MessagingSettings> {
  const previous = await readPrivateMessagingSettings();
  const next: PrivateMessagingSettings = {
    notifyOnTurnEnd: input.notifyOnTurnEnd !== false,
    notifyOnError: input.notifyOnError !== false,
    telegram: {
      enabled: input.telegram.enabled === true,
      controlEnabled: input.telegram.controlEnabled === true,
      chatId: input.telegram.chatId.trim(),
      botToken: input.telegram.clearBotToken === true
        ? ''
        : normalizeOptionalSecret(input.telegram.botToken) || previous.telegram.botToken,
      webhookBaseUrl: normalizeWebhookBaseUrl(input.telegram.webhookBaseUrl),
      webhookSecret: previous.telegram.webhookSecret || randomBytes(18).toString('hex'),
      localWebhookPort: normalizeWebhookPort(input.telegram.localWebhookPort),
    },
    feishu: {
      enabled: input.feishu.enabled === true,
      webhookUrl: input.feishu.clearWebhookUrl === true
        ? ''
        : normalizeOptionalSecret(input.feishu.webhookUrl) || previous.feishu.webhookUrl,
      secret: input.feishu.clearSecret === true
        ? ''
        : normalizeOptionalSecret(input.feishu.secret) || previous.feishu.secret,
    },
  };

  validateMessagingSettings(next);
  await writePrivateMessagingSettings(next);
  await syncTelegramControlSettings(previous, next);
  return toPublicMessagingSettings(next);
}

function validateMessagingSettings(settings: PrivateMessagingSettings): void {
  if (settings.telegram.enabled || settings.telegram.controlEnabled) {
    if (!settings.telegram.botToken) throw new Error('Telegram Bot Token is required when Telegram is enabled.');
    if (!settings.telegram.chatId) throw new Error('Telegram Chat ID is required when Telegram is enabled.');
  }

  if (settings.telegram.controlEnabled && !settings.telegram.webhookBaseUrl) {
    throw new Error('ngrok public URL is required when Telegram remote control is enabled.');
  }

  if (settings.feishu.enabled && !settings.feishu.webhookUrl) {
    throw new Error('Feishu Webhook URL is required when Feishu is enabled.');
  }
}

function toPublicMessagingSettings(settings: PrivateMessagingSettings): MessagingSettings {
  return {
    notifyOnTurnEnd: settings.notifyOnTurnEnd,
    notifyOnError: settings.notifyOnError,
    telegram: {
      enabled: settings.telegram.enabled,
      controlEnabled: settings.telegram.controlEnabled,
      chatId: settings.telegram.chatId,
      botToken: '',
      hasBotToken: settings.telegram.botToken.length > 0,
      clearBotToken: false,
      webhookBaseUrl: settings.telegram.webhookBaseUrl,
      localWebhookPort: settings.telegram.localWebhookPort,
    },
    feishu: {
      enabled: settings.feishu.enabled,
      webhookUrl: '',
      hasWebhookUrl: settings.feishu.webhookUrl.length > 0,
      clearWebhookUrl: false,
      secret: '',
      hasSecret: settings.feishu.secret.length > 0,
      clearSecret: false,
    },
  };
}

function normalizePrivateMessagingSettings(value: unknown): PrivateMessagingSettings {
  const record = isRecord(value) ? value : {};
  const telegram = isRecord(record.telegram) ? record.telegram : {};
  const feishu = isRecord(record.feishu) ? record.feishu : {};
  return {
    notifyOnTurnEnd: record.notifyOnTurnEnd !== false,
    notifyOnError: record.notifyOnError !== false,
    telegram: {
      enabled: telegram.enabled === true,
      controlEnabled: telegram.controlEnabled === true,
      chatId: stringValue(telegram.chatId) ?? '',
      botToken: stringValue(telegram.botToken) ?? '',
      webhookBaseUrl: normalizeWebhookBaseUrl(telegram.webhookBaseUrl),
      webhookSecret: stringValue(telegram.webhookSecret) ?? '',
      localWebhookPort: normalizeWebhookPort(telegram.localWebhookPort),
    },
    feishu: {
      enabled: feishu.enabled === true,
      webhookUrl: stringValue(feishu.webhookUrl) ?? '',
      secret: stringValue(feishu.secret) ?? '',
    },
  };
}

function cloneDefaultMessagingSettings(): PrivateMessagingSettings {
  return {
    notifyOnTurnEnd: DEFAULT_MESSAGING_SETTINGS.notifyOnTurnEnd,
    notifyOnError: DEFAULT_MESSAGING_SETTINGS.notifyOnError,
    telegram: { ...DEFAULT_MESSAGING_SETTINGS.telegram },
    feishu: { ...DEFAULT_MESSAGING_SETTINGS.feishu },
  };
}

function normalizeOptionalSecret(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWebhookBaseUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\/+$/, '');
}

function normalizeWebhookPort(value: unknown): number {
  const port = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : TELEGRAM_CONTROL_DEFAULT_PORT;
}

function normalizeMessagingProvider(value: unknown): MessagingProviderId {
  if (value === 'telegram' || value === 'feishu') return value;
  throw new Error('Unknown messaging provider.');
}

async function syncTelegramControlFromSettings(): Promise<void> {
  await syncTelegramControlSettings(undefined, await readPrivateMessagingSettings());
}

async function syncTelegramControlSettings(
  previous: PrivateMessagingSettings | undefined,
  next: PrivateMessagingSettings,
): Promise<void> {
  if (previous?.telegram.controlEnabled && !next.telegram.controlEnabled && previous.telegram.botToken) {
    await deleteTelegramWebhook(previous.telegram).catch(() => undefined);
  }

  if (!next.telegram.controlEnabled) {
    await stopTelegramControlServer();
    return;
  }

  await startTelegramControlServer(next.telegram.localWebhookPort);
  await setTelegramWebhook(next.telegram);
}

async function startTelegramControlServer(port: number): Promise<void> {
  if (telegramControlServer && telegramControlServerPort === port) return;
  await stopTelegramControlServer();

  const server = createServer((request, response) => {
    void handleTelegramControlRequest(request, response).catch((error) => {
      writeJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  telegramControlServer = server;
  telegramControlServerPort = port;
}

async function stopTelegramControlServer(): Promise<void> {
  if (!telegramControlServer) return;
  const server = telegramControlServer;
  telegramControlServer = undefined;
  telegramControlServerPort = undefined;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function handleTelegramControlRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === 'GET' && request.url === '/telegram/health') {
    writeJson(response, 200, { ok: true });
    return;
  }

  const match = request.url?.match(/^\/telegram\/webhook\/([a-f0-9]+)$/);
  if (request.method !== 'POST' || !match) {
    writeJson(response, 404, { ok: false });
    return;
  }

  const settings = await readPrivateMessagingSettings();
  if (!settings.telegram.controlEnabled || match[1] !== settings.telegram.webhookSecret) {
    writeJson(response, 403, { ok: false });
    return;
  }

  const body = await readRequestJson(request);
  void handleTelegramWebhookUpdate(settings, body).catch((error) => {
    void sendTelegramMessage(settings.telegram, `Telegram 控制处理失败：${error instanceof Error ? error.message : String(error)}`);
  });
  writeJson(response, 200, { ok: true });
}

async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function setTelegramWebhook(settings: PrivateMessagingSettings['telegram']): Promise<void> {
  const response = await messagingFetch('Telegram', `https://api.telegram.org/bot${settings.botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: telegramWebhookUrl(settings),
      allowed_updates: ['message'],
      drop_pending_updates: true,
    }),
  });
  const body = await safeReadJson(response);
  if (!response.ok || (isRecord(body) && body.ok === false)) {
    throw new Error(`Telegram webhook setup failed: ${formatRemoteError(response, body)}`);
  }
}

async function deleteTelegramWebhook(settings: PrivateMessagingSettings['telegram']): Promise<void> {
  const response = await messagingFetch('Telegram', `https://api.telegram.org/bot${settings.botToken}/deleteWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ drop_pending_updates: true }),
  });
  const body = await safeReadJson(response);
  if (!response.ok || (isRecord(body) && body.ok === false)) {
    throw new Error(`Telegram webhook delete failed: ${formatRemoteError(response, body)}`);
  }
}

function telegramWebhookUrl(settings: PrivateMessagingSettings['telegram']): string {
  return `${settings.webhookBaseUrl}/telegram/webhook/${settings.webhookSecret}`;
}

async function handleTelegramWebhookUpdate(settings: PrivateMessagingSettings, update: unknown): Promise<void> {
  const message = extractTelegramMessage(update);
  if (!message) return;
  if (message.chatId !== settings.telegram.chatId) {
    await sendTelegramMessage(settings.telegram, '这个 Chat ID 未被授权控制 Kimi Desktop。');
    return;
  }
  enqueueTelegramControlMessage(message.text, message.chatId);
}

function extractTelegramMessage(update: unknown): { chatId: string; text: string } | undefined {
  if (!isRecord(update)) return undefined;
  const message = isRecord(update.message) ? update.message : undefined;
  if (!message) return undefined;
  const chat = isRecord(message.chat) ? message.chat : undefined;
  const text = stringValue(message.text);
  if (!chat || !text) return undefined;
  const id = chat.id;
  if (typeof id !== 'number' && typeof id !== 'string') return undefined;
  return { chatId: String(id), text: text.trim() };
}

function enqueueTelegramControlMessage(text: string, chatId: string): void {
  telegramControlPromptQueue = telegramControlPromptQueue
    .then(() => handleTelegramControlText(text, chatId))
    .catch(async (error) => {
      const settings = await readPrivateMessagingSettings();
      await sendTelegramMessage(settings.telegram, `Kimi Desktop 处理失败：${error instanceof Error ? error.message : String(error)}`);
    });
}

async function handleTelegramControlText(text: string, chatId: string): Promise<void> {
  const settings = await readPrivateMessagingSettings();
  if (text === '/start' || text === '/help') {
    await sendTelegramMessage(settings.telegram, [
      'Kimi Desktop 已连接。',
      '直接发送消息即可让当前会话执行。',
      '可用命令：/status、/cancel、/new、/sessions、/usage。',
    ].join('\n'));
    return;
  }

  if (text === '/cancel') {
    await activeSession?.cancel();
    await sendTelegramMessage(settings.telegram, '已请求取消当前任务。');
    return;
  }

  const commandInput = parseSlashInput(text) === null ? undefined : text;
  if (commandInput !== undefined) {
    const result = await executeSlashCommand(commandInput);
    if (result.handled) {
      if (result.message) await sendTelegramMessage(settings.telegram, result.message);
      return;
    }
  }

  await ensureActiveSessionForTelegram();
  if (!activeSession) throw new Error('No active session');
  await sendTelegramMessage(settings.telegram, '已收到，正在交给 Kimi 处理。');
  const done = waitForTelegramTurn(chatId);
  try {
    await activeSession.prompt(text);
    await done;
  } catch (error) {
    clearTelegramTurnCapture(error);
    throw error;
  }
}

async function ensureActiveSessionForTelegram(): Promise<void> {
  if (activeSession) return;
  const h = getHarness();
  await h.ensureConfigFile();
  const config = await h.getConfig();
  const model = config.defaultModel;
  if (!model) throw new Error('No model configured. Set default_model in config.toml.');
  const session = await h.createSession({
    workDir: selectedWorkDir,
    model,
    thinking: normalizeThinking(config.thinking?.effort ?? (config.defaultThinking === false ? 'off' : 'high')),
    permission: normalizePermission(config.defaultPermissionMode),
  });
  attachSession(session);
}

function waitForTelegramTurn(chatId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    telegramTurnCapture = { chatId, chunks: [], resolve, reject };
  });
}

function clearTelegramTurnCapture(error: unknown): void {
  if (!telegramTurnCapture) return;
  const capture = telegramTurnCapture;
  telegramTurnCapture = undefined;
  capture.reject(error instanceof Error ? error : new Error(String(error)));
}

async function captureTelegramControlEvent(event: unknown): Promise<void> {
  if (!telegramTurnCapture || !isRecord(event)) return;

  if (event.type === 'assistant.delta') {
    const delta = stringValue(event.delta);
    if (delta) telegramTurnCapture.chunks.push(delta);
    return;
  }

  if (event.type === 'error') {
    const capture = telegramTurnCapture;
    telegramTurnCapture = undefined;
    await sendTelegramMessage((await readPrivateMessagingSettings()).telegram, `Kimi Desktop 出错：${stringValue(event.message) ?? 'Unknown error'}`);
    capture.resolve();
    return;
  }

  if (event.type === 'turn.ended') {
    const capture = telegramTurnCapture;
    telegramTurnCapture = undefined;
    const output = capture.chunks.join('').trim();
    if (output.length > 0) {
      await sendTelegramTextChunks((await readPrivateMessagingSettings()).telegram, output);
    } else {
      await sendTelegramMessage((await readPrivateMessagingSettings()).telegram, '任务已结束，但没有生成文本回复。');
    }
    capture.resolve();
  }
}

async function sendTelegramTextChunks(settings: PrivateMessagingSettings['telegram'], text: string): Promise<void> {
  for (let index = 0; index < text.length; index += TELEGRAM_MESSAGE_LIMIT) {
    await sendTelegramMessage(settings, text.slice(index, index + TELEGRAM_MESSAGE_LIMIT));
  }
}

async function notifyMessagingEvent(event: unknown): Promise<void> {
  if (!isRecord(event)) return;
  if (event.type !== 'turn.ended' && event.type !== 'error') return;

  const settings = await readPrivateMessagingSettings();
  if (event.type === 'turn.ended' && !settings.notifyOnTurnEnd) return;
  if (event.type === 'error' && !settings.notifyOnError) return;

  const message = event.type === 'turn.ended'
    ? formatMessagingNotification('Kimi Desktop task complete')
    : formatMessagingNotification(`Kimi Desktop error: ${stringValue(event.message) ?? 'Unknown error'}`);
  await sendEnabledMessagingProviders(settings, message);
}

function formatMessagingNotification(title: string): string {
  return [
    title,
    activeSession ? `Session: ${activeSession.id}` : undefined,
    selectedWorkDir ? `Workspace: ${selectedWorkDir}` : undefined,
  ].filter(Boolean).join('\n');
}

async function sendMessagingProvider(provider: MessagingProviderId, message: string): Promise<void> {
  const settings = await readPrivateMessagingSettings();
  if (provider === 'telegram') {
    await sendTelegramMessage(settings.telegram, message);
    return;
  }
  await sendFeishuMessage(settings.feishu, message);
}

async function sendEnabledMessagingProviders(settings: PrivateMessagingSettings, message: string): Promise<void> {
  await Promise.allSettled([
    settings.telegram.enabled ? sendTelegramMessage(settings.telegram, message) : Promise.resolve(),
    settings.feishu.enabled ? sendFeishuMessage(settings.feishu, message) : Promise.resolve(),
  ]);
}

async function sendTelegramMessage(settings: PrivateMessagingSettings['telegram'], text: string): Promise<void> {
  if (!settings.botToken) throw new Error('Telegram Bot Token is not configured.');
  if (!settings.chatId) throw new Error('Telegram Chat ID is not configured.');

  const response = await messagingFetch('Telegram', `https://api.telegram.org/bot${settings.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: settings.chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  const body = await safeReadJson(response);
  if (!response.ok || (isRecord(body) && body.ok === false)) {
    throw new Error(`Telegram send failed: ${formatRemoteError(response, body)}`);
  }
}

async function sendFeishuMessage(settings: PrivateMessagingSettings['feishu'], text: string): Promise<void> {
  if (!settings.webhookUrl) throw new Error('Feishu Webhook URL is not configured.');

  const payload: Record<string, unknown> = {
    msg_type: 'text',
    content: { text },
  };
  if (settings.secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    payload.timestamp = timestamp;
    payload.sign = createHmac('sha256', `${timestamp}\n${settings.secret}`).digest('base64');
  }

  const response = await messagingFetch('Feishu', settings.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await safeReadJson(response);
  if (!response.ok || isFeishuError(body)) {
    throw new Error(`Feishu send failed: ${formatRemoteError(response, body)}`);
  }
}

async function messagingFetch(provider: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await net.fetch(url, init);
  } catch (error) {
    throw new Error(`${provider} 网络请求失败：无法连接到消息服务。请确认当前网络或系统代理可以访问该服务。${formatErrorCause(error)}`);
  }
}

function isFeishuError(body: unknown): boolean {
  if (!isRecord(body)) return false;
  const code = body.code ?? body.StatusCode;
  if (typeof code === 'number') return code !== 0;
  if (typeof code === 'string') return code !== '0';
  return false;
}

async function safeReadJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatRemoteError(response: Response, body: unknown): string {
  if (isRecord(body)) {
    const message = stringValue(body.description) ?? stringValue(body.msg) ?? stringValue(body.message) ?? stringValue(body.StatusMessage);
    if (message) return message;
  }
  if (typeof body === 'string' && body.length > 0) return body.slice(0, 240);
  return `${response.status} ${response.statusText}`.trim();
}

function formatErrorCause(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) return '';
  return ` 原始错误：${error.message}`;
}

async function listSlashCommands(): Promise<SlashCommandInfo[]> {
  const skillCommands = await listSkillSlashCommands();
  return sortSlashCommands([...BUILTIN_SLASH_COMMANDS, ...skillCommands]);
}

async function listSkillSlashCommands(): Promise<SlashCommandInfo[]> {
  if (!activeSession) return [];
  try {
    const skills = await activeSession.listSkills() as readonly SkillSummaryLike[];
    return skills
      .filter(isUserActivatableSkill)
      .map((skill: SkillSummaryLike) => ({
        name: `skill:${String(skill.name)}`,
        aliases: [],
        description: typeof skill.description === 'string' ? skill.description : '',
        priority: 0,
        availability: 'idle-only' as const,
        source: 'skill' as const,
      }));
  } catch {
    return [];
  }
}

function isUserActivatableSkill(skill: SkillSummaryLike): boolean {
  if (typeof skill.name !== 'string' || skill.name.length === 0) return false;
  return (
    skill.type === undefined ||
    skill.type === 'prompt' ||
    skill.type === 'inline' ||
    skill.type === 'flow'
  );
}

function extractSlashCommandText(input: string | PromptInputPart[]): string | undefined {
  if (typeof input === 'string') {
    const text = input.trim();
    return parseSlashInput(text) === null ? undefined : text;
  }

  if (input.length !== 1) return undefined;
  const [part] = input;
  if (!part || part.type !== 'text') return undefined;
  const text = part.text.trim();
  return parseSlashInput(text) === null ? undefined : text;
}

async function executeSlashCommand(input: string): Promise<SlashCommandResult> {
  const parsed = parseSlashInput(input);
  if (parsed === null) return { handled: false };

  const commands = await listSlashCommands();
  const command = findSlashCommand(commands, parsed.name);
  if (!command) return { handled: false };

  if (command.source === 'skill') {
    if (!activeSession) throw new Error('No active session');
    const skillName = command.name.slice('skill:'.length);
    await activeSession.activateSkill(skillName, parsed.args);
    return { handled: true, startsTurn: true };
  }

  return executeBuiltinSlashCommand(command.name, parsed.args);
}

async function executeBuiltinSlashCommand(name: string, args: string): Promise<SlashCommandResult> {
  switch (name) {
    case 'help':
      return notice(formatHelp(await listSlashCommands()));
    case 'version':
      return notice(`Kimi Code v${app.getVersion()}`);
    case 'new':
      return createNewSessionFromSlash();
    case 'sessions':
      return handleSessionsCommand(args);
    case 'tasks':
      return handleTasksCommand();
    case 'mcp':
      return handleMcpCommand();
    case 'model':
      return handleModelCommand(args);
    case 'permission':
      return handlePermissionCommand(args);
    case 'settings':
      return handleSettingsCommand();
    case 'usage':
      return handleUsageCommand();
    case 'status':
      return handleStatusCommand();
    case 'feedback':
      await shell.openExternal(FEEDBACK_ISSUE_URL);
      return notice(`Opened feedback page:\n${FEEDBACK_ISSUE_URL}`);
    case 'title':
      return handleTitleCommand(args);
    case 'yolo':
      return handleYoloCommand(args);
    case 'plan':
      return handlePlanCommand(args);
    case 'compact':
      return handleCompactCommand(args);
    case 'init':
      return handleInitCommand();
    case 'fork':
      return handleForkCommand();
    case 'logout':
      return handleLogoutCommand();
    case 'login':
      return notice('Desktop login is handled from the model configuration dialog. Open settings and configure your API source there.');
    case 'editor':
      return notice('/editor configures the terminal Ctrl-G external editor. The desktop app does not use that terminal editor setting.');
    case 'theme':
      return notice('/theme is a terminal UI setting. The desktop app theme is not controlled by this command yet.');
    case 'exit':
      targetWindow?.close();
      return notice('Closing Kimi Desktop.');
    default:
      return { handled: false };
  }
}

function notice(message: string): SlashCommandResult {
  return { handled: true, message };
}

async function createNewSessionFromSlash(): Promise<SlashCommandResult> {
  const h = getHarness();
  await h.ensureConfigFile();
  const config = await h.getConfig();
  const model = config.defaultModel;
  if (!model) throw new Error('No model configured. Set default_model in config.toml.');

  const session = await h.createSession({
    workDir: selectedWorkDir,
    model,
    thinking: normalizeThinking(config.thinking?.effort ?? (config.defaultThinking === false ? 'off' : 'high')),
    permission: normalizePermission(config.defaultPermissionMode),
  });
  attachSession(session);
  return {
    handled: true,
    message: `Started a fresh session: ${session.id}`,
    session: { id: session.id, workDir: session.workDir, messages: [] },
    runtime: await getRuntimeSettings(),
  };
}

async function handleSessionsCommand(args: string): Promise<SlashCommandResult> {
  const h = getHarness();
  const sessionId = args.trim();
  if (sessionId.length > 0) {
    const session = await h.resumeSession({ id: sessionId });
    attachSession(session);
    return {
      handled: true,
      message: `Resumed session: ${session.id}`,
      session: {
        id: session.id,
        workDir: session.workDir,
        title: session.summary?.title,
        messages: replayMessages(session),
      },
      runtime: await getRuntimeSettings(),
    };
  }

  const sessions = await h.listSessions({ workDir: selectedWorkDir });
  if (sessions.length === 0) return notice('No sessions in the current workspace.');
  const lines = sessions.slice(0, 12).map((session: any) => {
    const title = session.title ?? session.lastPrompt ?? '(untitled)';
    const marker = activeSession?.id === session.id ? '*' : '-';
    return `${marker} ${session.id}  ${title}`;
  });
  return notice(`Sessions in ${selectedWorkDir}:\n${lines.join('\n')}`);
}

async function handleTasksCommand(): Promise<SlashCommandResult> {
  if (!activeSession) throw new Error('No active session');
  const tasks = await activeSession.listBackgroundTasks({ activeOnly: false });
  if (tasks.length === 0) return notice('No background tasks.');
  const lines = tasks.slice(0, 20).map((task: any) => {
    const description = typeof task.description === 'string' ? task.description : '';
    return `- ${task.taskId ?? task.id ?? 'task'}  ${task.status ?? 'unknown'}  ${description}`;
  });
  return notice(`Background tasks:\n${lines.join('\n')}`);
}

async function handleMcpCommand(): Promise<SlashCommandResult> {
  if (!activeSession) throw new Error('No active session');
  const servers = await activeSession.listMcpServers();
  if (servers.length === 0) return notice('No MCP servers configured.');
  const lines = servers.map((server: any) => {
    const status = server.status ?? server.state ?? 'unknown';
    const tools = Array.isArray(server.tools) ? ` (${server.tools.length} tools)` : '';
    return `- ${server.name ?? 'server'}: ${status}${tools}`;
  });
  return notice(`MCP servers:\n${lines.join('\n')}`);
}

async function handleModelCommand(args: string): Promise<SlashCommandResult> {
  const settings = await getRuntimeSettings();
  const model = args.trim();
  if (model.length === 0) {
    const lines = settings.models.map((item) => `${item === settings.selectedModel ? '*' : '-'} ${item}`);
    return notice(`Available models:\n${lines.join('\n') || '(none configured)'}`);
  }
  if (!settings.models.includes(model)) {
    return { handled: true, error: `Unknown model alias: ${model}` };
  }
  await activeSession?.setModel(model);
  await getHarness().setConfig({ defaultModel: model });
  return {
    handled: true,
    message: `Switched to model: ${model}`,
    runtime: await getRuntimeSettings(),
  };
}

async function handlePermissionCommand(args: string): Promise<SlashCommandResult> {
  const mode = args.trim();
  if (mode.length === 0) {
    const settings = await getRuntimeSettings();
    return notice(`Permission mode: ${settings.permission}\nAvailable: manual, auto, yolo`);
  }
  if (mode !== 'manual' && mode !== 'auto' && mode !== 'yolo') {
    return { handled: true, error: `Unknown permission mode: ${mode}` };
  }
  await activeSession?.setPermission(mode);
  await getHarness().setConfig({ defaultPermissionMode: mode });
  return {
    handled: true,
    message: `Permission mode: ${mode}`,
    runtime: await getRuntimeSettings(),
  };
}

async function handleSettingsCommand(): Promise<SlashCommandResult> {
  const h = getHarness();
  await h.ensureConfigFile();
  const error = await shell.openPath(h.configPath);
  if (error) return { handled: true, error };
  return notice(`Opened config file:\n${h.configPath}`);
}

async function handleUsageCommand(): Promise<SlashCommandResult> {
  if (!activeSession) throw new Error('No active session');
  return notice(formatUsage(await activeSession.getUsage()));
}

async function handleStatusCommand(): Promise<SlashCommandResult> {
  if (!activeSession) throw new Error('No active session');
  const status = await activeSession.getStatus();
  return notice([
    `Session: ${activeSession.id}`,
    `Workdir: ${activeSession.workDir}`,
    `Model: ${status.model ?? '(unknown)'}`,
    `Thinking: ${status.thinkingLevel}`,
    `Permission: ${status.permission}`,
    `Plan mode: ${status.planMode ? 'on' : 'off'}`,
    `Context: ${formatNumber(status.contextTokens)} / ${formatNumber(status.maxContextTokens)} (${Math.round(status.contextUsage * 100)}%)`,
  ].join('\n'));
}

async function handleTitleCommand(args: string): Promise<SlashCommandResult> {
  if (!activeSession) throw new Error('No active session');
  const title = args.trim();
  if (title.length === 0) {
    return notice(`Session title: ${activeSession.summary?.title ?? '(not set)'}\nSession id: ${activeSession.id}`);
  }
  const nextTitle = title.slice(0, 200);
  await getHarness().renameSession({ id: activeSession.id, title: nextTitle });
  return notice(`Session title set to: ${nextTitle}`);
}

async function handleYoloCommand(args: string): Promise<SlashCommandResult> {
  if (!activeSession) throw new Error('No active session');
  const subcmd = args.trim().toLowerCase();
  const current = await activeSession.getStatus();
  let enabled: boolean;
  if (subcmd === 'on') enabled = true;
  else if (subcmd === 'off') enabled = false;
  else if (subcmd.length === 0) enabled = current.permission !== 'yolo';
  else return { handled: true, error: `Unknown yolo subcommand: ${subcmd}` };

  const mode: PermissionMode = enabled ? 'yolo' : 'manual';
  await activeSession.setPermission(mode);
  await getHarness().setConfig({ defaultPermissionMode: mode });
  return {
    handled: true,
    message: enabled
      ? 'YOLO mode: ON\nAll actions will be approved automatically. Use with caution.'
      : 'YOLO mode: OFF',
    runtime: await getRuntimeSettings(),
  };
}

async function handlePlanCommand(args: string): Promise<SlashCommandResult> {
  if (!activeSession) throw new Error('No active session');
  const subcmd = args.trim().toLowerCase();
  if (subcmd === 'clear') {
    await activeSession.clearPlan();
    return notice('Plan cleared.');
  }

  const current = await activeSession.getStatus();
  let enabled: boolean;
  if (subcmd.length === 0) enabled = !current.planMode;
  else if (subcmd === 'on') enabled = true;
  else if (subcmd === 'off') enabled = false;
  else return { handled: true, error: `Unknown plan subcommand: ${subcmd}` };

  await activeSession.setPlanMode(enabled);
  return notice(`Plan mode: ${enabled ? 'ON' : 'OFF'}`);
}

async function handleCompactCommand(args: string): Promise<SlashCommandResult> {
  if (!activeSession) throw new Error('No active session');
  await activeSession.compact({ instruction: args.trim() || undefined });
  return notice('Conversation context compacted.');
}

async function handleInitCommand(): Promise<SlashCommandResult> {
  if (!activeSession) throw new Error('No active session');
  await activeSession.init();
  return { handled: true, startsTurn: true };
}

async function handleForkCommand(): Promise<SlashCommandResult> {
  if (!activeSession) throw new Error('No active session');
  const sourceTitle = activeSession.summary?.title?.trim() || activeSession.id;
  const forked = await getHarness().forkSession({
    id: activeSession.id,
    title: `Fork: ${sourceTitle}`,
  });
  attachSession(forked);
  return {
    handled: true,
    message: `Session forked: ${forked.id}`,
    session: {
      id: forked.id,
      workDir: forked.workDir,
      title: forked.summary?.title,
      messages: replayMessages(forked),
    },
    runtime: await getRuntimeSettings(),
  };
}

async function handleLogoutCommand(): Promise<SlashCommandResult> {
  await getHarness().auth.logout(DEFAULT_OAUTH_PROVIDER_NAME);
  return notice('Logged out.');
}

function formatHelp(commands: readonly SlashCommandInfo[]): string {
  return commands
    .map((command) => {
      const aliases = command.aliases.length > 0 ? ` (${command.aliases.map((alias) => `/${alias}`).join(', ')})` : '';
      return `/${command.name}${aliases}  ${command.description}`;
    })
    .join('\n');
}

function formatUsage(usage: Awaited<ReturnType<Session['getUsage']>>): string {
  const lines = ['Usage:'];
  if (usage.total) {
    lines.push(`Total: ${formatTokenUsage(usage.total)}`);
  }
  if (usage.currentTurn) {
    lines.push(`Current turn: ${formatTokenUsage(usage.currentTurn)}`);
  }
  if (usage.byModel) {
    for (const [model, value] of Object.entries(usage.byModel) as Array<[string, Parameters<typeof formatTokenUsage>[0]]>) {
      lines.push(`${model}: ${formatTokenUsage(value)}`);
    }
  }
  return lines.join('\n');
}

function formatTokenUsage(usage: {
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
}): string {
  const input = usage.inputOther + usage.inputCacheRead + usage.inputCacheCreation;
  return `input ${formatNumber(input)}, output ${formatNumber(usage.output)}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
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

function isNodeError(value: unknown): value is Error & { code: string } {
  return value instanceof Error && typeof (value as { code?: unknown }).code === 'string';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
