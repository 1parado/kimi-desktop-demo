import { useChatStore } from '../store/chat';

const projects = [
  { name: '七牛简历', items: ['按图片顺序生成Word文档', '你好啊', '打招呼'] },
  { name: '本草节气展板', items: [] },
  { name: 'UI设计', items: [] },
  { name: '毕业论文', items: [] },
  { name: '42API', items: [] },
];

export function Sidebar() {
  const sessionId = useChatStore((s) => s.sessionId);
  const clearMessages = useChatStore((s) => s.clearMessages);

  function handleNewChat() {
    clearMessages();
  }

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
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-[var(--muted)]">2 周</span>
        </div>
        <div className="space-y-2">
          <button className="thread-row strong">实习总结</button>
          <button className="thread-row">我的论文题目：基于杜邦分析</button>
        </div>
      </div>

      <div className="sidebar-scroll mt-6 flex-1 overflow-y-auto px-4 pb-4">
        <div className="mb-3 text-[12px] text-[var(--muted)]">项目</div>
        <div className="space-y-4">
          {projects.map((project) => (
            <section key={project.name}>
              <div className="project-title">
                <span className="folder-glyph" />
                <span className="truncate">{project.name}</span>
              </div>
              {project.items.length > 0 ? (
                <div className="mt-2 space-y-1 pl-5">
                  {project.items.map((item) => (
                    <button key={item} className="thread-row subtle">
                      {item}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-2 pl-5 text-[12px] text-[var(--muted-soft)]">暂无对话</div>
              )}
            </section>
          ))}
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
