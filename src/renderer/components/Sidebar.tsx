import { useEffect } from 'react';
import { useChatStore } from '../store/chat';
import { useSettingsStore } from '../store/settings';
import type { SessionSummary } from '../../preload/index';

export function Sidebar() {
  const sessionId = useChatStore((s) => s.sessionId);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const { sessions, workDir, loadSettings } = useSettingsStore();

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  function handleNewChat() {
    clearMessages();
  }

  const recentSessions = [...sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 2);
  const projects = groupSessionsByWorkDir(sessions);

  return (
    <aside className="sidebar-panel flex w-[266px] shrink-0 flex-col">
      <div className="flex h-[74px] items-center gap-3 px-4">
        <button className="icon-button muted" aria-label="Toggle sidebar">
          <span className="mini-window" />
        </button>
        <div className="brand-mark grid h-9 w-9 place-items-center rounded-xl text-sm font-semibold">
          K
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--ink)]">Kimi Desktop</div>
          <div className="text-[11px] text-[var(--muted)]">Agent workspace</div>
        </div>
        <button
          onClick={handleNewChat}
          className="icon-button"
          title="New session"
          aria-label="New session"
        >
          +
        </button>
      </div>

      <nav className="space-y-1 px-3">
        {['新对话', '搜索', '技能', '插件', '自动化'].map((item, index) => (
          <button key={item} className={`nav-item ${index === 0 ? 'active' : ''}`}>
            <span className="nav-dot" />
            <span>{item}</span>
          </button>
        ))}
      </nav>

      <div className="mt-5 px-4">
        <div className="mb-3 flex items-center justify-between text-[12px] text-[var(--muted)]">
          <span>置顶</span>
          {recentSessions[0] && (
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-[var(--muted)]">
              {formatRelativeTime(recentSessions[0].updatedAt)}
            </span>
          )}
        </div>
        <div className="space-y-2">
          {recentSessions.length > 0 ? (
            recentSessions.map((session) => (
              <button key={session.id} className="thread-row strong" title={session.id}>
                {sessionTitle(session)}
              </button>
            ))
          ) : (
            <div className="px-2 text-[12px] text-[var(--muted-soft)]">暂无会话</div>
          )}
        </div>
      </div>

      <div className="sidebar-scroll mt-6 flex-1 overflow-y-auto px-4 pb-4">
        <div className="mb-3 text-[12px] text-[var(--muted)]">项目</div>
        <div className="space-y-4">
          {projects.length > 0 ? (
            projects.map((project) => (
              <section key={project.workDir}>
                <div className="project-title" title={project.workDir}>
                  <span className="folder-glyph" />
                  <span className="truncate">{projectName(project.workDir)}</span>
                </div>
                <div className="mt-2 space-y-1 pl-5">
                  {project.sessions.slice(0, 5).map((session) => (
                    <button key={session.id} className="thread-row subtle" title={session.id}>
                      {sessionTitle(session)}
                    </button>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <section>
              <div className="project-title" title={workDir}>
                <span className="folder-glyph" />
                <span className="truncate">{projectName(workDir) || '当前工作区'}</span>
              </div>
              <div className="mt-2 pl-5 text-[12px] text-[var(--muted-soft)]">暂无对话</div>
            </section>
          )}
        </div>

        {sessionId ? (
          <div className="session-card mt-6">
            <div className="mb-2 h-1 w-10 rounded-full bg-[var(--kimi-green)]" />
            <div className="truncate font-mono text-[11px] text-[var(--ink-muted)]">{sessionId}</div>
            <div className="mt-2 text-[11px] text-[var(--muted)]">Active conversation</div>
          </div>
        ) : (
          <div className="session-card empty mt-6">
            <div className="text-xs text-[var(--ink-muted)]">No active session</div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">Send a message to begin</div>
          </div>
        )}
      </div>

      <div className="px-4 py-4">
        <button className="settings-row">
          <span className="settings-gear" />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}

function groupSessionsByWorkDir(sessions: SessionSummary[]): Array<{ workDir: string; sessions: SessionSummary[] }> {
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const group = groups.get(session.workDir) ?? [];
    group.push(session);
    groups.set(session.workDir, group);
  }
  return Array.from(groups, ([projectWorkDir, projectSessions]) => ({
    workDir: projectWorkDir,
    sessions: projectSessions.sort((a, b) => b.updatedAt - a.updatedAt),
  }));
}

function sessionTitle(session: SessionSummary): string {
  return session.title || session.lastPrompt || session.id;
}

function projectName(path: string): string {
  if (!path) return '';
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} 分`;
  if (diff < day) return `${Math.round(diff / hour)} 小时`;
  return `${Math.round(diff / day)} 天`;
}
