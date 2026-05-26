import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { useAgent } from '../hooks/useAgent';

const tools = [
  { name: '文件', description: '浏览项目文件', glyph: 'F' },
  { name: '浏览器', description: '打开网站', glyph: 'B' },
  { name: '终端', description: '启动交互式 shell', glyph: 'T' },
];

export function ChatView() {
  const { sendMessage, cancel, isLoading } = useAgent();

  return (
    <div className="desktop-stage flex h-full min-w-0 flex-col">
      <header className="top-chrome flex h-[84px] shrink-0 items-center justify-between px-6">
        <div className="window-tabs">
          <button className="tab-pill active">
            <span className="tab-logo">K</span>
            <span>Kimi Code</span>
          </button>
          <button className="tab-add" aria-label="New tab">+</button>
        </div>
        <div className="chrome-actions">
          <button className="chrome-button" aria-label="Full screen" />
          <button className="chrome-button minus" aria-label="Minimize" />
          <button className="chrome-button split" aria-label="Split view" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="conversation-plane min-w-0 flex-1">
          <MessageList isLoading={isLoading} />
          <InputArea onSend={sendMessage} onCancel={cancel} isLoading={isLoading} />
        </section>

        <aside className="tool-dock hidden w-[360px] shrink-0 items-center justify-center px-6 xl:flex">
          <div className="grid w-full grid-cols-3 gap-3">
            {tools.map((tool) => (
              <button key={tool.name} className="tool-tile">
                <span className="tool-icon">{tool.glyph}</span>
                <span className="mt-3 text-sm font-semibold text-[var(--ink)]">{tool.name}</span>
                <span className="mt-1 text-xs text-[var(--muted)]">{tool.description}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
