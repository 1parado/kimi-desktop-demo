import { useState, useRef, type KeyboardEvent } from 'react';
import { useSettingsStore } from '../store/settings';
import type { PermissionMode, ThinkingLevel } from '../../preload/index';

interface InputAreaProps {
  onSend: (input: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}

export function InputArea({ onSend, onCancel, isLoading }: InputAreaProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    workDir,
    models,
    selectedModel,
    thinking,
    permission,
    setModel,
    setThinking,
    setPermission,
  } = useSettingsStore();

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
            <label className="permission-pill">
              <span className="permission-dot" />
              <select
                value={permission}
                onChange={(event) => void setPermission(event.target.value as PermissionMode)}
                className="control-select permission-select"
                aria-label="审批方式"
              >
                <option value="manual">手动审批</option>
                <option value="yolo">完全访问权限</option>
                <option value="auto">自动权限</option>
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="model-badge">Kimi</span>
            <select
              value={selectedModel ?? ''}
              onChange={(event) => void setModel(event.target.value)}
              className="control-select model-select"
              aria-label="模型"
            >
              {models.length === 0 ? (
                <option value="">未配置模型</option>
              ) : (
                models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))
              )}
            </select>
            <select
              value={thinking}
              onChange={(event) => void setThinking(event.target.value as ThinkingLevel)}
              className="control-select thinking-select"
              aria-label="思考强度"
            >
              <option value="off">关闭</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="xhigh">很高</option>
              <option value="max">最高</option>
            </select>
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
          <span className="truncate">{workDir || '未选择工作区'}</span>
          <span className="chevron">⌄</span>
        </div>
      </div>
    </div>
  );
}
