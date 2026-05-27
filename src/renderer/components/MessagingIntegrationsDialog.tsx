import { useEffect, useState } from 'react';
import type { MessagingProviderId, MessagingSettings } from '../../shared/messaging';

interface MessagingIntegrationsDialogProps {
  open: boolean;
  onClose: () => void;
}

const emptySettings: MessagingSettings = {
  notifyOnTurnEnd: true,
  notifyOnError: true,
  telegram: {
    enabled: false,
    controlEnabled: false,
    chatId: '',
    botToken: '',
    hasBotToken: false,
    clearBotToken: false,
    webhookBaseUrl: '',
    localWebhookPort: 8787,
  },
  feishu: {
    enabled: false,
    webhookUrl: '',
    hasWebhookUrl: false,
    clearWebhookUrl: false,
    secret: '',
    hasSecret: false,
    clearSecret: false,
  },
};

export function MessagingIntegrationsDialog({ open, onClose }: MessagingIntegrationsDialogProps) {
  const [form, setForm] = useState<MessagingSettings>(emptySettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<MessagingProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaved(false);
    setTestResult(null);
    window.kimiAPI?.getMessagingSettings()
      .then((settings) => {
        if (!cancelled) setForm(settings);
      })
      .catch((reason) => {
        if (!cancelled) setError(formatError(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    const api = window.kimiAPI;
    if (!api) {
      setError('Kimi desktop bridge is unavailable.');
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    setTestResult(null);
    try {
      const result = await api.saveMessagingSettings(form);
      setForm(result.settings);
      setSaved(true);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(provider: MessagingProviderId) {
    const api = window.kimiAPI;
    if (!api) {
      setError('Kimi desktop bridge is unavailable.');
      return;
    }

    setTesting(provider);
    setError(null);
    setSaved(false);
    setTestResult(null);
    try {
      await api.saveMessagingSettings(form);
      const result = await api.testMessaging({ provider });
      const latest = await api.getMessagingSettings();
      setForm(latest);
      setTestResult(result.message);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-dialog messaging-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="messaging-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-dialog-header">
          <div>
            <div className="settings-eyebrow">MESSAGING</div>
            <h2 id="messaging-settings-title">即时通讯接入</h2>
          </div>
          <button type="button" className="settings-close" aria-label="关闭即时通讯设置" onClick={onClose}>
            <span />
          </button>
        </header>

        <div className="settings-dialog-body">
          <div className="messaging-switches">
            <label className="messaging-check">
              <input
                type="checkbox"
                checked={form.notifyOnTurnEnd}
                onChange={(event) => setForm((value) => ({ ...value, notifyOnTurnEnd: event.target.checked }))}
              />
              <span>任务完成时通知</span>
            </label>
            <label className="messaging-check">
              <input
                type="checkbox"
                checked={form.notifyOnError}
                onChange={(event) => setForm((value) => ({ ...value, notifyOnError: event.target.checked }))}
              />
              <span>出错时通知</span>
            </label>
          </div>

          <section className="messaging-provider">
            <div className="messaging-provider-header">
              <label className="messaging-check">
                <input
                  type="checkbox"
                  checked={form.telegram.enabled}
                  disabled={loading}
                  onChange={(event) => setForm((value) => ({
                    ...value,
                    telegram: { ...value.telegram, enabled: event.target.checked },
                  }))}
                />
                <span>Telegram Bot</span>
              </label>
              <button
                type="button"
                className="settings-button secondary"
                disabled={loading || saving || testing !== null}
                onClick={() => void handleTest('telegram')}
              >
                {testing === 'telegram' ? '发送中' : '测试'}
              </button>
            </div>
            <div className="settings-grid">
              <label className="settings-field">
                <span>Bot Token</span>
                <div className="settings-secret-row">
                  <input
                    value={form.telegram.botToken ?? ''}
                    disabled={loading || form.telegram.clearBotToken === true}
                    type="password"
                    placeholder={form.telegram.hasBotToken ? '已配置，留空保持不变' : '123456:ABC...'}
                    onChange={(event) => setForm((value) => ({
                      ...value,
                      telegram: { ...value.telegram, botToken: event.target.value },
                    }))}
                  />
                  <button
                    type="button"
                    className={form.telegram.clearBotToken === true ? 'active' : ''}
                    disabled={loading}
                    onClick={() => setForm((value) => ({
                      ...value,
                      telegram: {
                        ...value.telegram,
                        botToken: '',
                        clearBotToken: value.telegram.clearBotToken !== true,
                      },
                    }))}
                  >
                    清空
                  </button>
                </div>
              </label>
              <label className="settings-field">
                <span>Chat ID</span>
                <input
                  value={form.telegram.chatId}
                  disabled={loading}
                  placeholder="-1001234567890"
                  onChange={(event) => setForm((value) => ({
                    ...value,
                    telegram: { ...value.telegram, chatId: event.target.value },
                  }))}
                />
              </label>
              <label className="settings-field">
                <span>远程控制</span>
                <label className="messaging-check inline">
                  <input
                    type="checkbox"
                    checked={form.telegram.controlEnabled}
                    disabled={loading}
                    onChange={(event) => setForm((value) => ({
                      ...value,
                      telegram: { ...value.telegram, controlEnabled: event.target.checked },
                    }))}
                  />
                  <span>允许 Telegram 控制当前会话</span>
                </label>
              </label>
              <label className="settings-field">
                <span>ngrok URL</span>
                <input
                  value={form.telegram.webhookBaseUrl}
                  disabled={loading || !form.telegram.controlEnabled}
                  placeholder="https://example.ngrok-free.app"
                  onChange={(event) => setForm((value) => ({
                    ...value,
                    telegram: { ...value.telegram, webhookBaseUrl: event.target.value },
                  }))}
                />
              </label>
            </div>
          </section>

          <section className="messaging-provider">
            <div className="messaging-provider-header">
              <label className="messaging-check">
                <input
                  type="checkbox"
                  checked={form.feishu.enabled}
                  disabled={loading}
                  onChange={(event) => setForm((value) => ({
                    ...value,
                    feishu: { ...value.feishu, enabled: event.target.checked },
                  }))}
                />
                <span>飞书自定义机器人</span>
              </label>
              <button
                type="button"
                className="settings-button secondary"
                disabled={loading || saving || testing !== null}
                onClick={() => void handleTest('feishu')}
              >
                {testing === 'feishu' ? '发送中' : '测试'}
              </button>
            </div>
            <label className="settings-field">
              <span>Webhook URL</span>
              <div className="settings-secret-row messaging-wide-secret">
                <input
                  value={form.feishu.webhookUrl ?? ''}
                  disabled={loading || form.feishu.clearWebhookUrl === true}
                  type="password"
                  placeholder={form.feishu.hasWebhookUrl ? '已配置，留空保持不变' : 'https://open.feishu.cn/open-apis/bot/v2/hook/...'}
                  onChange={(event) => setForm((value) => ({
                    ...value,
                    feishu: { ...value.feishu, webhookUrl: event.target.value },
                  }))}
                />
                <button
                  type="button"
                  className={form.feishu.clearWebhookUrl === true ? 'active' : ''}
                  disabled={loading}
                  onClick={() => setForm((value) => ({
                    ...value,
                    feishu: {
                      ...value.feishu,
                      webhookUrl: '',
                      clearWebhookUrl: value.feishu.clearWebhookUrl !== true,
                    },
                  }))}
                >
                  清空
                </button>
              </div>
            </label>
            <label className="settings-field">
              <span>签名密钥</span>
              <div className="settings-secret-row messaging-wide-secret">
                <input
                  value={form.feishu.secret ?? ''}
                  disabled={loading || form.feishu.clearSecret === true}
                  type="password"
                  placeholder={form.feishu.hasSecret ? '已配置，留空保持不变' : '可选，机器人开启签名校验时填写'}
                  onChange={(event) => setForm((value) => ({
                    ...value,
                    feishu: { ...value.feishu, secret: event.target.value },
                  }))}
                />
                <button
                  type="button"
                  className={form.feishu.clearSecret === true ? 'active' : ''}
                  disabled={loading}
                  onClick={() => setForm((value) => ({
                    ...value,
                    feishu: {
                      ...value.feishu,
                      secret: '',
                      clearSecret: value.feishu.clearSecret !== true,
                    },
                  }))}
                >
                  清空
                </button>
              </div>
            </label>
          </section>

          {error && <div className="settings-alert error">{error}</div>}
          {saved && <div className="settings-alert success">已保存</div>}
          {testResult && <div className="settings-alert success">{testResult}</div>}
        </div>

        <footer className="settings-dialog-actions">
          <button type="button" className="settings-button secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="settings-button primary"
            disabled={loading || saving || testing !== null}
            onClick={() => void handleSave()}
          >
            {saving ? '保存中' : '保存'}
          </button>
        </footer>
      </section>
    </div>
  );
}

function formatError(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
