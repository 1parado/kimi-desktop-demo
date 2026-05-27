# Kimi Desktop

Kimi Desktop is an Electron-based desktop client for Kimi Code. It wraps the
Kimi Code SDK with a React UI for chat-driven coding work, workspace/session
management, file and diff previews, approval prompts, attachments, and CLI-style
slash commands.

## Features

- Desktop chat interface backed by `@moonshot-ai/kimi-code-sdk`.
- Workspace selection and session create/resume flows.
- Model, thinking level, and permission mode controls.
- File and image attachments in the prompt composer.
- Approval dialogs for tool actions that require user confirmation.
- Markdown, math, Mermaid, and rich assistant response rendering.
- Side preview panel for selected files and Git diffs.
- Slash command palette with built-in Kimi Code commands and dynamic
  `skill:*` commands from the active session.

## Slash Commands

Type `/` in the composer to open the command palette. The desktop app exposes
the same core command set as the CLI where the SDK supports it, including:

- `/help`, `/version`, `/status`, `/usage`
- `/new`, `/sessions [id]`, `/fork`, `/title [name]`
- `/model [alias]`, `/permission [manual|auto|yolo]`, `/yolo [on|off]`
- `/plan [on|off|clear]`, `/compact [instruction]`, `/init`
- `/tasks`, `/mcp`, `/settings`, `/feedback`, `/logout`, `/exit`
- `skill:<name>` commands loaded from active session skills

Some terminal-only CLI commands are intentionally adapted for the desktop UI:
`/tasks` and `/mcp` render summaries in the chat, while `/editor` and `/theme`
show explanatory notices because they configure the terminal TUI.

## Requirements

- Node.js compatible with the monorepo toolchain.
- pnpm.
- A Kimi Code configuration with at least one model/provider.

This package uses workspace dependencies, so install dependencies from the
monorepo root before running the desktop app:

```bash
pnpm install
```

## Development

From `kimi-desktop`:

```bash
pnpm run dev
```

The dev script starts:

- `tsdown --watch` for Electron main/preload builds.
- Vite dev server on `http://localhost:5173`.
- Electron after both build outputs are ready.

## Build

Build the Electron main/preload bundles and renderer assets:

```bash
pnpm run build
```

Start the app from a production build:

```bash
pnpm run start
```

Create platform packages with Electron Builder:

```bash
pnpm run build:electron
```

Configured targets:

- Windows: NSIS installer
- macOS: DMG
- Linux: AppImage

## Configuration

Runtime model configuration is read through the Kimi Code SDK. In the desktop
UI, use the configuration/settings controls to edit the model alias, provider,
base URL, API key, and context size.

The composer exposes runtime controls for:

- Model alias
- Thinking level
- Permission mode
- Workspace directory

## Telegram Integration

Kimi Desktop can send Telegram notifications and, when remote control is
enabled, accept Telegram messages through a webhook exposed by ngrok.

### Get a Bot Token

1. Open Telegram and talk to `@BotFather`.
2. Run `/newbot` and follow the prompts.
3. Copy the bot token from BotFather.

Do not commit the token to the repository. If a token is exposed, revoke it in
`@BotFather` and generate a new one.

### Get the Chat ID

1. Open the chat with your bot, not `@BotFather`.
2. Send a message such as `/start` or `hello`.
3. Open this URL in a browser, replacing `BOT_TOKEN` with your real token:

```text
https://api.telegram.org/botBOT_TOKEN/getUpdates
```

4. Find the `chat.id` field in the JSON response:

```json
{
  "chat": {
    "id": 123456789
  }
}
```

Use that value as the Chat ID. Group and channel IDs are often negative, for
example `-1001234567890`.

If the response is `{"ok":true,"result":[]}`, clear any existing webhook, send
the bot a new message, and call `getUpdates` again:

```text
https://api.telegram.org/botBOT_TOKEN/deleteWebhook
https://api.telegram.org/botBOT_TOKEN/getUpdates
```

### Enable Notifications

1. Open the Messaging settings in the desktop sidebar.
2. Enable `Telegram Bot`.
3. Enter the Bot Token and Chat ID.
4. Click `测试` to send a test message.
5. Click `保存`.

### Enable Telegram Remote Control

Telegram Bot API delivers remote commands through HTTPS webhooks. For local
development, expose the desktop webhook server with ngrok:

```bash
ngrok http 8787
```

Copy the HTTPS forwarding URL from ngrok, then in Messaging settings:

1. Enable `允许 Telegram 控制当前会话`.
2. Paste the ngrok HTTPS URL into `ngrok URL`.
3. Save the settings.
4. Send `/help` to the bot from the configured Chat ID.

Only the saved Chat ID is allowed to control the desktop app. Supported starter
commands include `/help`, `/status`, `/cancel`, `/new`, `/sessions`, and
`/usage`. Plain text messages are sent to the current Kimi session; if no
session is active, the app creates one using the current workspace and default
model configuration.

## Project Structure

```text
src/
  main/        Electron main process and SDK/IPc orchestration
  preload/     Secure renderer bridge exposed as window.kimiAPI
  renderer/    React UI, stores, hooks, and components
  shared/      Shared IPC channels and slash command metadata
```

Important entry points:

- `src/main/index.ts` starts Electron.
- `src/main/ipc.ts` registers SDK and system IPC handlers.
- `src/preload/index.ts` exposes the renderer API.
- `src/renderer/App.tsx` lays out the desktop shell.
- `src/renderer/components/InputArea.tsx` implements the prompt composer and
  slash command palette.

## Verification

Use the production build command as the main smoke test:

```bash
pnpm run build
```

`pnpm run typecheck` is available, but this monorepo can surface workspace
package path-alias issues when TypeScript resolves package sources directly.
The desktop packaging path is validated by `pnpm run build`.
