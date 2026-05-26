import { useState } from 'react';
import type { ReactNode } from 'react';
import type { PreviewDiffResult, PreviewFileResult } from '../../preload/index';

type PreviewMode = 'diff' | 'file' | 'browser';

interface PreviewPanelProps {
  onClose: () => void;
}

export function PreviewPanel({ onClose }: PreviewPanelProps) {
  const [mode, setMode] = useState<PreviewMode>('diff');
  const [filePreview, setFilePreview] = useState<PreviewFileResult | null>(null);
  const [diffPreview, setDiffPreview] = useState<PreviewDiffResult | null>(null);
  const [urlInput, setUrlInput] = useState('https://');
  const [previewUrl, setPreviewUrl] = useState('');
  const [isLoading, setLoading] = useState(false);

  async function loadDiff() {
    setMode('diff');
    setLoading(true);
    try {
      const result = await window.kimiAPI?.getGitDiff();
      if (result) setDiffPreview(result);
    } finally {
      setLoading(false);
    }
  }

  async function openFile() {
    setMode('file');
    setLoading(true);
    try {
      const result = await window.kimiAPI?.selectPreviewFile();
      if (result) setFilePreview(result);
    } finally {
      setLoading(false);
    }
  }

  function openBrowser() {
    setMode('browser');
    const normalized = normalizeUrl(urlInput);
    if (normalized) setPreviewUrl(normalized);
  }

  return (
    <aside className="preview-panel">
      <div className="preview-header">
        <div>
          <div className="preview-eyebrow">Preview</div>
          <div className="preview-title">文档 / Diff / 浏览器</div>
        </div>
        <button className="preview-close" type="button" onClick={onClose} aria-label="隐藏预览">
          Hide
        </button>
      </div>

      <div className="preview-tabs">
        <button className={mode === 'diff' ? 'active' : ''} type="button" onClick={() => void loadDiff()}>
          Git diff
        </button>
        <button className={mode === 'file' ? 'active' : ''} type="button" onClick={() => void openFile()}>
          文件
        </button>
        <button className={mode === 'browser' ? 'active' : ''} type="button" onClick={() => setMode('browser')}>
          浏览器
        </button>
      </div>

      <div className="preview-body">
        {mode === 'diff' && (
          <PreviewFrame
            title={diffPreview?.workDir ?? '当前工作区 diff'}
            actionLabel={isLoading ? '读取中...' : '刷新 diff'}
            onAction={() => void loadDiff()}
          >
            <pre className="preview-code">{diffPreview?.content ?? '点击“刷新 diff”查看当前工作区修改。'}</pre>
          </PreviewFrame>
        )}

        {mode === 'file' && (
          <PreviewFrame
            title={filePreview?.name ?? '文件预览'}
            subtitle={filePreview?.path}
            actionLabel={isLoading ? '打开中...' : '选择文件'}
            onAction={() => void openFile()}
          >
            {filePreview ? (
              <>
                {filePreview.truncated && (
                  <div className="preview-warning">文件较大，仅显示前 1 MB。</div>
                )}
                <pre className="preview-code">{filePreview.content}</pre>
              </>
            ) : (
              <div className="preview-empty">选择一个文件后，可以在这里直接查看内容。</div>
            )}
          </PreviewFrame>
        )}

        {mode === 'browser' && (
          <div className="browser-preview">
            <div className="browser-bar">
              <input
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') openBrowser();
                }}
                placeholder="https://example.com"
              />
              <button type="button" onClick={openBrowser}>打开</button>
            </div>
            {previewUrl ? (
              <iframe title="网页预览" src={previewUrl} className="browser-frame" sandbox="allow-scripts allow-forms allow-same-origin" />
            ) : (
              <div className="preview-empty browser-empty">输入 URL 后，这里会作为内置浏览器预览区。</div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function PreviewFrame({
  title,
  subtitle,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  subtitle?: string;
  actionLabel: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <div className="preview-frame">
      <div className="preview-frame-header">
        <div className="min-w-0">
          <div className="preview-frame-title">{title}</div>
          {subtitle && <div className="preview-frame-subtitle">{subtitle}</div>}
        </div>
        <button type="button" onClick={onAction}>{actionLabel}</button>
      </div>
      <div className="preview-content">{children}</div>
    </div>
  );
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === 'https://') return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
