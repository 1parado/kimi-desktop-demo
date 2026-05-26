import { useChatStore } from '../store/chat';

export function ApprovalDialog() {
  const pendingApproval = useChatStore((s) => s.pendingApproval);
  const setPendingApproval = useChatStore((s) => s.setPendingApproval);

  if (!pendingApproval) return null;

  function respond(response: unknown) {
    if (!pendingApproval) return;
    window.kimiAPI?.respondApproval({ requestId: pendingApproval.requestId, response });
    setPendingApproval(null);
  }

  return (
    <div className="approval-backdrop">
      <section className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        <div className="approval-header">
          <div>
            <p className="approval-eyebrow">需要你的批准</p>
            <h2 id="approval-title" className="approval-title">{pendingApproval.toolName}</h2>
          </div>
          <span className="approval-badge">Tool</span>
        </div>

        <div className="approval-body">
          <p className="approval-action">{pendingApproval.action}</p>
          <pre className="approval-summary">{pendingApproval.summary}</pre>
          {pendingApproval.detail && <pre className="approval-detail">{pendingApproval.detail}</pre>}
        </div>

        <div className="approval-actions">
          <button
            className="approval-button ghost"
            onClick={() => respond({ decision: 'rejected', feedback: 'Rejected in Kimi Desktop.' })}
          >
            拒绝
          </button>
          <button className="approval-button secondary" onClick={() => respond({ decision: 'approved' })}>
            允许一次
          </button>
          <button className="approval-button primary" onClick={() => respond({ decision: 'approved', scope: 'session' })}>
            本会话允许
          </button>
        </div>
      </section>
    </div>
  );
}
