import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { ApprovalDialog } from './ApprovalDialog';
import { useAgent } from '../hooks/useAgent';
import type { SendMessageInput } from '../hooks/useAgent';

interface ChatViewProps {
  previewOpen: boolean;
  onTogglePreview: () => void;
}

export function ChatView({ previewOpen, onTogglePreview }: ChatViewProps) {
  const { sendMessage, cancel, isLoading } = useAgent();
  const handleSend = (input: SendMessageInput) => void sendMessage(input);

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
            className={`icon-button muted layout-toggle ${previewOpen ? 'active' : ''}`}
            aria-label={previewOpen ? '隐藏预览' : '打开预览'}
            title={previewOpen ? '隐藏预览' : '打开预览'}
            onClick={onTogglePreview}
          >
            <span className="layout-toggle-icon right" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="conversation-plane min-w-0 flex-1">
          <MessageList isLoading={isLoading} />
          <InputArea onSend={handleSend} onCancel={cancel} isLoading={isLoading} />
        </section>
      </div>
      <ApprovalDialog />
    </div>
  );
}
