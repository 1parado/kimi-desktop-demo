import { useEffect, useState } from 'react';
import { useSettingsStore } from '../store/settings';
import type { ConfigModelSettings } from '../../preload/index';

interface ConfigSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const emptySettings: ConfigModelSettings = {
  configPath: '',
  modelAlias: 'kimi-k2.6',
  model: 'kimi-k2.6',
  provider: 'kimi-k2.6',
  baseUrl: '',
  apiKey: '',
  hasApiKey: false,
  clearApiKey: false,
  maxContextSize: 262144,
};

export function ConfigSettingsDialog({ open, onClose }: ConfigSettingsDialogProps) {
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const [form, setForm] = useState<ConfigModelSettings>(emptySettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaved(false);
    window.kimiAPI?.getConfigModelSettings()
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
    try {
      const result = await api.saveConfigModelSettings(form);
      setForm({ ...result.settings, apiKey: '', clearApiKey: false });
      await loadSettings();
      setSaved(true);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setSaving(false);
    }
  }

  async function handleOpenConfig() {
    try {
      await window.kimiAPI?.openConfigFile();
    } catch (reason) {
      setError(formatError(reason));
    }
  }

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-dialog-header">
          <div>
            <div className="settings-eyebrow">CONFIG.TOML</div>
            <h2 id="config-settings-title">模型配置</h2>
          </div>
          <button type="button" className="settings-close" aria-label="关闭设置" onClick={onClose}>
            <span />
          </button>
        </header>

        <div className="settings-dialog-body">
          <label className="settings-field">
            <span>配置文件</span>
            <div className="settings-path-row">
              <input value={form.configPath || 'config.toml'} readOnly />
              <button type="button" onClick={() => void handleOpenConfig()}>
                打开
              </button>
            </div>
          </label>

          <div className="settings-grid">
            <label className="settings-field">
              <span>模型别名</span>
              <input
                value={form.modelAlias}
                disabled={loading}
                onChange={(event) => {
                  const modelAlias = event.target.value;
                  setForm((value) => ({
                    ...value,
                    modelAlias,
                    provider: value.provider === value.modelAlias ? modelAlias : value.provider,
                    model: value.model === value.modelAlias ? modelAlias : value.model,
                  }));
                }}
              />
            </label>
            <label className="settings-field">
              <span>Provider</span>
              <input
                value={form.provider}
                disabled={loading}
                onChange={(event) => setForm((value) => ({ ...value, provider: event.target.value }))}
              />
            </label>
          </div>

          <label className="settings-field">
            <span>Base URL</span>
            <input
              value={form.baseUrl}
              disabled={loading}
              placeholder="https://api.example.com/v1"
              onChange={(event) => setForm((value) => ({ ...value, baseUrl: event.target.value }))}
            />
          </label>

          <label className="settings-field">
            <span>API Key</span>
            <div className="settings-secret-row">
              <input
                value={form.apiKey}
                disabled={loading || form.clearApiKey === true}
                type="password"
                placeholder={form.hasApiKey ? '已配置，留空保持不变' : 'sk-...'}
                onChange={(event) => setForm((value) => ({ ...value, apiKey: event.target.value }))}
              />
              <button
                type="button"
                className={form.clearApiKey === true ? 'active' : ''}
                disabled={loading}
                onClick={() => {
                  setForm((value) => ({
                    ...value,
                    apiKey: '',
                    clearApiKey: value.clearApiKey !== true,
                  }));
                }}
              >
                清空
              </button>
            </div>
          </label>

          <div className="settings-grid">
            <label className="settings-field">
              <span>模型名称</span>
              <input
                value={form.model}
                disabled={loading}
                onChange={(event) => setForm((value) => ({ ...value, model: event.target.value }))}
              />
            </label>
            <label className="settings-field">
              <span>上下文</span>
              <input
                value={String(form.maxContextSize)}
                disabled={loading}
                inputMode="numeric"
                onChange={(event) => {
                  const maxContextSize = Number(event.target.value);
                  setForm((value) => ({ ...value, maxContextSize }));
                }}
              />
            </label>
          </div>

          {error && <div className="settings-alert error">{error}</div>}
          {saved && <div className="settings-alert success">已保存</div>}
        </div>

        <footer className="settings-dialog-actions">
          <button type="button" className="settings-button secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="settings-button primary"
            disabled={loading || saving}
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
