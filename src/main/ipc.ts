import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron';
import { KimiHarness } from '@moonshot-ai/kimi-code-sdk';
import type { Session } from '@moonshot-ai/kimi-code-sdk';
import { IPC } from '../shared/ipc-channels';

let harness: KimiHarness | null = null;
let activeSession: Session | null = null;
let targetWindow: BrowserWindow | null = null;
let handlersRegistered = false;
let requestCounter = 0;

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

export function registerIpcHandlers(win: BrowserWindow): void {
  targetWindow = win;
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle(IPC.SYSTEM_DEFAULT_WORKDIR, async () => process.cwd());

  ipcMain.handle(IPC.SESSION_CREATE, async (_event, options: { workDir?: string; model?: string }) => {
    const h = getHarness();
    await h.ensureConfigFile();
    const config = await h.getConfig();
    const model = options.model ?? config.defaultModel;
    if (!model) {
      throw new Error('No model configured. Set default_model in config.toml.');
    }

    const session = await h.createSession({
      workDir: options.workDir?.trim() || process.cwd(),
      model,
      permission: 'manual',
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

  ipcMain.handle(IPC.SESSION_LIST, async (_event, workDir: string) => {
    const h = getHarness();
    return h.listSessions({ workDir });
  });
}
