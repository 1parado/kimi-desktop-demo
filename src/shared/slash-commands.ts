export type SlashCommandSource = 'builtin' | 'skill';
export type SlashCommandAvailability = 'always' | 'idle-only';

export interface SlashCommandInfo {
  name: string;
  aliases: string[];
  description: string;
  priority: number;
  availability: SlashCommandAvailability;
  source: SlashCommandSource;
}

export interface ParsedSlashInput {
  name: string;
  args: string;
}

export interface SlashCommandResult {
  handled: boolean;
  startsTurn?: boolean;
  message?: string;
  error?: string;
  runtime?: unknown;
  session?: {
    id: string;
    workDir: string;
    title?: string;
    messages?: unknown[];
  };
}

export const BUILTIN_SLASH_COMMANDS: readonly SlashCommandInfo[] = [
  {
    name: 'yolo',
    aliases: ['yes'],
    description: 'Toggle auto-approve mode',
    priority: 100,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'permission',
    aliases: [],
    description: 'Select permission mode',
    priority: 100,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'settings',
    aliases: ['config'],
    description: 'Open TUI settings',
    priority: 100,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'plan',
    aliases: [],
    description: 'Toggle plan mode',
    priority: 100,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'model',
    aliases: [],
    description: 'Switch LLM model',
    priority: 100,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show available commands and shortcuts',
    priority: 80,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'new',
    aliases: ['clear'],
    description: 'Start a fresh session in the current workspace',
    priority: 80,
    availability: 'idle-only',
    source: 'builtin',
  },
  {
    name: 'sessions',
    aliases: ['resume'],
    description: 'Browse and resume sessions',
    priority: 80,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'tasks',
    aliases: ['task'],
    description: 'Browse background tasks',
    priority: 80,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'compact',
    aliases: [],
    description: 'Compact the conversation context',
    priority: 80,
    availability: 'idle-only',
    source: 'builtin',
  },
  {
    name: 'fork',
    aliases: [],
    description: 'Fork the current session',
    priority: 80,
    availability: 'idle-only',
    source: 'builtin',
  },
  {
    name: 'mcp',
    aliases: [],
    description: 'Show MCP server status',
    priority: 60,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'title',
    aliases: ['rename'],
    description: 'Set or show session title',
    priority: 60,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'usage',
    aliases: [],
    description: 'Show session tokens + context window + plan quotas',
    priority: 60,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'status',
    aliases: [],
    description: 'Show current session and runtime status',
    priority: 60,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'feedback',
    aliases: [],
    description: 'Send feedback to make Kimi Code better',
    priority: 60,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'editor',
    aliases: [],
    description: 'Set the external editor for Ctrl-G',
    priority: 60,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'theme',
    aliases: [],
    description: 'Set the terminal UI theme',
    priority: 60,
    availability: 'always',
    source: 'builtin',
  },
  {
    name: 'logout',
    aliases: [],
    description: 'Clear credentials for the current platform',
    priority: 40,
    availability: 'idle-only',
    source: 'builtin',
  },
  {
    name: 'login',
    aliases: [],
    description: 'Select a platform and authenticate',
    priority: 40,
    availability: 'idle-only',
    source: 'builtin',
  },
  {
    name: 'init',
    aliases: [],
    description: 'Analyze the codebase and generate AGENTS.md',
    priority: 0,
    availability: 'idle-only',
    source: 'builtin',
  },
  {
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit the application',
    priority: 20,
    availability: 'idle-only',
    source: 'builtin',
  },
  {
    name: 'version',
    aliases: [],
    description: 'Show version information',
    priority: 20,
    availability: 'always',
    source: 'builtin',
  },
];

export function parseSlashInput(input: string): ParsedSlashInput | null {
  if (!input.startsWith('/')) return null;
  const trimmed = input.slice(1).trim();
  if (trimmed.length === 0) return null;
  const spaceIdx = trimmed.indexOf(' ');
  const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  if (name.includes('/')) return null;
  return { name, args };
}

export function findSlashCommand(
  commands: readonly SlashCommandInfo[],
  name: string,
): SlashCommandInfo | undefined {
  return commands.find((command) => command.name === name || command.aliases.includes(name));
}

export function sortSlashCommands(commands: readonly SlashCommandInfo[]): SlashCommandInfo[] {
  return [...commands].sort(
    (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
  );
}
