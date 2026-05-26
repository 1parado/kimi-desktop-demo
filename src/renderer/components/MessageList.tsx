import { useRef, useEffect, useState } from 'react';
import { useChatStore } from '../store/chat';
import type { Message } from '../store/chat';
import { MarkdownMessage } from './MarkdownMessage';

function ToolMessageBubble({ message }: { message: Message }) {
  const status = message.toolStatus ?? 'completed';
  const [isExpanded, setExpanded] = useState(false);
  const detailId = `${message.id}-tool-detail`;

  return (
    <div className="flex justify-start">
      <div className={`message-bubble tool ${status} ${isExpanded ? 'expanded' : 'collapsed'}`}>
        <button
          type="button"
          className="tool-message-summary"
          aria-expanded={isExpanded}
          aria-controls={detailId}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className={`tool-status-dot ${status}`} />
          <span className="tool-message-name">{message.toolName ?? 'Tool'}</span>
          <span className="tool-status-label">{statusLabel(status)}</span>
          <span className="tool-toggle-label">{isExpanded ? '隐藏' : '展开'}</span>
          <span className="tool-toggle-chevron" aria-hidden="true" />
        </button>
        {isExpanded && (
          <div id={detailId} className="tool-message-detail">
            {message.content}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  copied,
  onCopy,
}: {
  message: Message;
  copied: boolean;
  onCopy: (message: Message) => void;
}) {
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
    return <ToolMessageBubble message={message} />;
  }

  return (
    <div className="flex justify-start">
      <div className="message-bubble assistant">
        <div className="assistant-message-header">
          <span className="assistant-message-label">Kimi</span>
          <button
            className={`copy-response-button ${copied ? 'copied' : ''}`}
            type="button"
            aria-label="复制 AI 回复"
            title="复制 AI 回复"
            onClick={() => onCopy(message)}
          >
            <span className="copy-response-icon" aria-hidden="true" />
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
        <div className="markdown-message">
          <MarkdownMessage content={message.content} isStreaming={message.isStreaming} />
          {message.isStreaming && <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded bg-[var(--accent)] align-middle" />}
        </div>
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
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId((current) => (current === message.id ? null : current)), 1600);
    } catch {
      setCopiedMessageId(null);
    }
  }

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
        <MessageBubble
          key={msg.id}
          message={msg}
          copied={copiedMessageId === msg.id}
          onCopy={copyMessage}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
