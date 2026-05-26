import { useState } from 'react';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { ApprovalDialog } from './ApprovalDialog';
import { PreviewPanel } from './PreviewPanel';
import { useAgent } from '../hooks/useAgent';
import type { SendMessageInput } from '../hooks/useAgent';

export function ChatView() {
  const [previewOpen, setPreviewOpen] = useState(true);
  const { sendMessage, cancel, isLoading } = useAgent();
  const handleSend = (input: SendMessageInput) => void sendMessage(input);
  const minimizeWindow = () => void window.kimiAPI?.minimizeWindow();
  const toggleMaximizeWindow = () => void window.kimiAPI?.toggleMaximizeWindow();

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
          <button
            className="chrome-button maximize"
            aria-label="最大化窗口"
            title="最大化窗口"
            onClick={toggleMaximizeWindow}
          >
            <span />
          </button>
          <button
            className="chrome-button minimize"
            aria-label="最小化窗口"
            title="最小化窗口"
            onClick={minimizeWindow}
          >
            <span />
          </button>
          <button
            className={`chrome-button split ${previewOpen ? 'active' : ''}`}
            aria-label={previewOpen ? '隐藏预览' : '打开预览'}
            title={previewOpen ? '隐藏预览' : '打开预览'}
            onClick={() => setPreviewOpen((open) => !open)}
          >
            <span />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="conversation-plane min-w-0 flex-1">
          <MessageList isLoading={isLoading} />
          <InputArea onSend={handleSend} onCancel={cancel} isLoading={isLoading} />
        </section>

        {previewOpen && <PreviewPanel onClose={() => setPreviewOpen(false)} />}
      </div>
      <ApprovalDialog />
    </div>
  );
}
