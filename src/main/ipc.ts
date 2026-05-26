import { ipcMain, type BrowserWindow } from 'electron';
import { KimiHarness } from '@moonshot-ai/kimi-code-sdk';
import type { Session } from '@moonshot-ai/kimi-code-sdk';
import { IPC } from '../shared/ipc-channels';

let harness: KimiHarness | null = null;
let activeSession: Session | null = null;
let targetWindow: BrowserWindow | null = null;
let handlersRegistered = false;

function getHarness(): KimiHarness {
  if (!harness) {
    harness = new KimiHarness({});
  }
  return harness;
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
      permission: 'auto',
    });

    activeSession = session;

    session.onEvent((event: unknown) => {
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send(IPC.AGENT_EVENT, event);
      }
    });

    session.setApprovalHandler(async (request: unknown) => {
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send(IPC.AGENT_APPROVAL, request);
      }
      return { decision: 'approved' };
    });

    session.setQuestionHandler(async (request: unknown) => {
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send(IPC.AGENT_QUESTION, request);
      }
      return null;
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
