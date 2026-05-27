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
