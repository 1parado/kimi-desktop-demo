import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { PreviewPanel } from './components/PreviewPanel';

type ResizeTarget = 'sidebar' | 'preview';

const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 420;
const PREVIEW_MIN = 360;
const PREVIEW_MAX = 760;
const CENTER_MIN = 480;

export function App() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(266);
  const [previewWidth, setPreviewWidth] = useState(520);

  function startResize(target: ResizeTarget, startEvent: ReactPointerEvent<HTMLDivElement>) {
    const shell = shellRef.current;
    if (!shell) return;
    startEvent.currentTarget.setPointerCapture(startEvent.pointerId);
    const rect = shell.getBoundingClientRect();

    function handlePointerMove(event: globalThis.PointerEvent) {
      if (target === 'sidebar') {
        const occupiedRight = previewOpen ? previewWidth : 0;
        const maxSidebar = Math.min(SIDEBAR_MAX, rect.width - occupiedRight - CENTER_MIN);
        const nextWidth = clamp(event.clientX - rect.left, SIDEBAR_MIN, maxSidebar);
        setSidebarWidth(nextWidth);
        return;
      }

      const occupiedLeft = sidebarOpen ? sidebarWidth : 0;
      const maxPreview = Math.min(PREVIEW_MAX, rect.width - occupiedLeft - CENTER_MIN);
      const nextWidth = clamp(rect.right - event.clientX, PREVIEW_MIN, maxPreview);
      setPreviewWidth(nextWidth);
    }

    function stopResize() {
      document.body.classList.remove('is-resizing-layout');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
    }

    document.body.classList.add('is-resizing-layout');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize, { once: true });
  }

  return (
    <div ref={shellRef} className="app-shell flex h-screen overflow-hidden text-slate-950">
      {sidebarOpen ? (
        <>
          <Sidebar width={sidebarWidth} onToggleSidebar={() => setSidebarOpen(false)} />
          <ResizeHandle label="调整侧栏宽度" onPointerDown={(event) => startResize('sidebar', event)} />
        </>
      ) : (
        <button
          className="sidebar-reopen"
          type="button"
          aria-label="展开侧栏"
          title="展开侧栏"
          onClick={() => setSidebarOpen(true)}
        >
          <span className="layout-toggle-icon left" />
        </button>
      )}

      <main className="min-w-[360px] flex-1">
        <ChatView previewOpen={previewOpen} onTogglePreview={() => setPreviewOpen((open) => !open)} />
      </main>

      {previewOpen && (
        <>
          <ResizeHandle label="调整预览宽度" onPointerDown={(event) => startResize('preview', event)} />
          <PreviewPanel width={previewWidth} />
        </>
      )}
    </div>
  );
}

function ResizeHandle({
  label,
  onPointerDown,
}: {
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
    />
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
