import { useRef, useEffect } from 'react';
import { useChatStore } from '../store/chat';
import type { Message } from '../store/chat';

function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="message-bubble user">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }

  if (message.role === 'tool') {
    const status = message.toolStatus ?? 'completed';
    return (
      <div className="flex justify-start">
        <div className={`message-bubble tool ${status}`}>
          <div className="mb-2 flex items-center gap-2">
            <span className={`tool-status-dot ${status}`} />
            <div className="font-mono text-[11px] uppercase text-[var(--warning)]">{message.toolName}</div>
            <span className="tool-status-label">{statusLabel(status)}</span>
          </div>
          <div className="leading-5 text-[var(--ink-muted)]">{message.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="message-bubble assistant whitespace-pre-wrap">
        {message.content}
        {message.isStreaming && <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded bg-[var(--accent)] align-middle" />}
      </div>
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running':
      return '运行中';
    case 'failed':
      return '失败';
    default:
      return '完成';
  }
}

export function MessageList({ isLoading }: { isLoading: boolean }) {
  const messages = useChatStore((s) => s.messages);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="welcome-canvas flex flex-1 items-center justify-center px-6">
        <div className="welcome-copy w-full max-w-3xl text-center">
          <div className="kimi-sigil mx-auto mb-7">K</div>
          <h1 className="text-[30px] font-semibold leading-tight tracking-normal text-[var(--ink)] md:text-[34px]">
            我们应该在 Kimi Desktop 中做些什么？
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">
            从当前工作区开始，让 Kimi 处理代码理解、修改、测试和桌面自动化任务。
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/75 px-3 py-1.5 text-xs text-[var(--muted)] shadow-sm">
            <span className={`status-dot ${isLoading ? 'working' : ''}`} />
            <span>{isLoading ? 'Kimi 正在工作' : '本地 Agent 已就绪'}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-scroll flex-1 space-y-4 overflow-y-auto px-6 py-8">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
