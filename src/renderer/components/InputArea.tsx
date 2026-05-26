import { useState, useRef, type KeyboardEvent } from 'react';

interface InputAreaProps {
  onSend: (input: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}

export function InputArea({ onSend, onCancel, isLoading }: InputAreaProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  function handleInput() {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }

  return (
    <div className="composer-wrap shrink-0 px-6 pb-8">
      <div className="composer mx-auto max-w-[730px]">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder="尽管问"
          rows={1}
          className="min-h-[54px] w-full resize-none bg-transparent px-3 pt-3 text-sm leading-6 text-[var(--ink)] placeholder-[var(--muted-soft)] outline-none"
        />
        <div className="composer-toolbar">
          <div className="flex min-w-0 items-center gap-3">
            <button className="plain-action" aria-label="Attach">+</button>
            <button className="permission-pill" type="button">
              <span className="permission-dot" />
              完全访问权限
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="model-badge">Kimi</span>
            <button className="model-select" type="button">K2 高</button>
            {isLoading ? (
              <button onClick={onCancel} className="send-button stop" aria-label="Stop">
                Stop
              </button>
            ) : (
              <button onClick={handleSend} disabled={!value.trim()} className="send-button" aria-label="Send">
                ↑
              </button>
            )}
          </div>
        </div>
        <div className="workspace-strip">
          <span className="folder-glyph" />
          <span>七牛简历</span>
          <span className="chevron">⌄</span>
        </div>
      </div>
    </div>
  );
}
