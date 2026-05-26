import { useState, useRef, type KeyboardEvent } from 'react';
import { useSettingsStore } from '../store/settings';
import type { PromptInputPart, PermissionMode, ThinkingLevel } from '../../preload/index';
import type { SendMessageInput } from '../hooks/useAgent';

interface InputAreaProps {
  onSend: (input: SendMessageInput) => void;
  onCancel: () => void;
  isLoading: boolean;
}

interface ComposerAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  kind: 'image' | 'text' | 'file';
  content: string;
}

const MAX_TEXT_ATTACHMENT_BYTES = 1024 * 1024;

export function InputArea({ onSend, onCancel, isLoading }: InputAreaProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    workDir,
    models,
    selectedModel,
    thinking,
    permission,
    setModel,
    setThinking,
    setPermission,
    selectWorkDir,
  } = useSettingsStore();

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || isLoading) return;
    onSend(buildSubmission(trimmed, attachments));
    setValue('');
    setAttachments([]);
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

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next = await Promise.all(Array.from(files, readAttachment));
    setAttachments((current) => [...current, ...next]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  const canSend = value.trim().length > 0 || attachments.length > 0;

  return (
    <div className="composer-wrap shrink-0 px-6 pb-8">
      <div className="composer mx-auto max-w-[730px]">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => void handleFilesSelected(event.currentTarget.files)}
        />
        {attachments.length > 0 && (
          <div className="attachment-tray">
            {attachments.map((attachment) => (
              <div key={attachment.id} className={`attachment-chip ${attachment.kind}`}>
                <span className="attachment-icon">{attachment.kind === 'image' ? 'IMG' : 'FILE'}</span>
                <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                <span className="attachment-size">{formatBytes(attachment.size)}</span>
                <button
                  type="button"
                  className="attachment-remove"
                  aria-label={`移除 ${attachment.name}`}
                  onClick={() => removeAttachment(attachment.id)}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
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
            <button
              className="plain-action attach-action"
              aria-label="上传文件或图片"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              +
            </button>
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
              <button onClick={handleSend} disabled={!canSend} className="send-button" aria-label="Send">
                ↑
              </button>
            )}
          </div>
        </div>
        <button className="workspace-strip" type="button" onClick={() => void selectWorkDir()}>
          <span className="folder-glyph" />
          <span className="truncate">{workDir || '未选择工作区'}</span>
          <span className="chevron">⌄</span>
        </button>
      </div>
    </div>
  );
}

async function readAttachment(file: File): Promise<ComposerAttachment> {
  const base = {
    id: createAttachmentId(),
    name: file.name,
    size: file.size,
    type: file.type,
  };

  if (file.type.startsWith('image/')) {
    return {
      ...base,
      kind: 'image',
      content: await readAsDataUrl(file),
    };
  }

  if (isTextLikeFile(file)) {
    if (file.size > MAX_TEXT_ATTACHMENT_BYTES) {
      return {
        ...base,
        kind: 'file',
        content: `文本文件超过 ${formatBytes(MAX_TEXT_ATTACHMENT_BYTES)}，未读取内容。`,
      };
    }
    return {
      ...base,
      kind: 'text',
      content: await file.text(),
    };
  }

  return {
    ...base,
    kind: 'file',
    content: '此文件不是可直接读取的文本或图片，已附加文件元信息。',
  };
}

function buildSubmission(text: string, attachments: ComposerAttachment[]): SendMessageInput {
  const parts: PromptInputPart[] = [];
  if (text.length > 0) {
    parts.push({ type: 'text', text });
  } else if (attachments.length > 0) {
    parts.push({ type: 'text', text: '请分析这些附件。' });
  }

  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      parts.push({
        type: 'image_url',
        imageUrl: { url: attachment.content, id: attachment.name },
      });
      continue;
    }

    parts.push({
      type: 'text',
      text: [
        '',
        `附件：${attachment.name}`,
        `类型：${attachment.type || 'unknown'}`,
        `大小：${formatBytes(attachment.size)}`,
        attachment.kind === 'text' ? '内容：' : '说明：',
        attachment.content,
      ].join('\n'),
    });
  }

  const displayText = [
    text,
    ...attachments.map((attachment) => `[附件] ${attachment.name} (${formatBytes(attachment.size)})`),
  ].filter(Boolean).join('\n');

  return {
    text,
    prompt: parts,
    displayText,
  };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image.'));
      }
    });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read file.')));
    reader.readAsDataURL(file);
  });
}

function isTextLikeFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  return /\.(c|cc|cpp|cs|css|csv|go|h|hpp|html|java|js|jsx|json|jsonl|log|md|mdx|py|rs|sh|sql|toml|ts|tsx|txt|xml|yaml|yml)$/i
    .test(file.name);
}

function createAttachmentId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
