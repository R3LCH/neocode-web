import { useCallback, useEffect, useState } from "react";
import type { BridgeClient } from "../bridge/client";
import type { BridgeSettings } from "@protocol/schema";
import {
  ACCENT_PRESETS,
  applyPrefs,
  loadPrefs,
  savePrefs,
  type WebPrefs,
  type WebTheme,
} from "./webPrefs";

type Props = { client: BridgeClient; onDisconnect: () => void };

const THEMES: Array<{ id: WebTheme; label: string }> = [
  { id: "midnight", label: "Midnight" },
  { id: "graphite", label: "Graphite" },
  { id: "light", label: "Light" },
];

export function SettingsPanel({ client, onDisconnect }: Props) {
  const [prefs, setPrefs] = useState<WebPrefs>(() => loadPrefs());
  const [settings, setSettings] = useState<BridgeSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const updatePrefs = (patch: Partial<WebPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
    applyPrefs(next);
  };

  const refresh = useCallback(() => {
    client
      .call<BridgeSettings>("settings.get")
      .then(setSettings)
      .catch((e) => setError(String(e)));
  }, [client]);

  useEffect(() => {
    refresh();
    return client.on((event, data) => {
      if (event === "settings.changed") setSettings(data as BridgeSettings);
    });
  }, [client, refresh]);

  const apply = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setError("");
    try {
      const next = await client.call<BridgeSettings>("settings.set", patch);
      setSettings(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel settings-panel">
      <h2>Settings</h2>
      {error && <p className="error">{error}</p>}

      <section className="settings-group">
        <h3>Appearance · this device</h3>
        <div className="setting-row">
          <span className="setting-label">Theme</span>
          <div className="segmented">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={prefs.theme === t.id ? "active" : ""}
                onClick={() => updatePrefs({ theme: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <span className="setting-label">Accent</span>
          <div className="swatches">
            {ACCENT_PRESETS.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.label}
                className={`swatch${prefs.accent === a.color ? " active" : ""}`}
                style={{ background: a.color }}
                onClick={() => updatePrefs({ accent: a.color })}
              />
            ))}
          </div>
        </div>
        <div className="setting-row">
          <span className="setting-label">Text size</span>
          <div className="segmented">
            {[90, 100, 110].map((scale) => (
              <button
                key={scale}
                type="button"
                className={prefs.fontScale === scale ? "active" : ""}
                onClick={() => updatePrefs({ fontScale: scale })}
              >
                {scale === 90 ? "S" : scale === 100 ? "M" : "L"}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-group">
        <h3>Terminals · this device</h3>
        <div className="setting-row">
          <span className="setting-label">Wrap long lines by default</span>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.terminalWrap}
            className={`toggle${prefs.terminalWrap ? " on" : ""}`}
            onClick={() => updatePrefs({ terminalWrap: !prefs.terminalWrap })}
          >
            <span className="toggle-knob" />
          </button>
        </div>
        <p className="hint">zi / zo in the Terminals tab switch wrapping per session.</p>
      </section>

      {settings ? (
        <>
          <section className="settings-group">
            <h3>Desktop IDE · provider</h3>
            <label>
              Provider
              <select
                value={settings.provider_id}
                disabled={saving}
                onChange={(e) => apply({ provider_id: e.target.value })}
              >
                {settings.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <select
                value={settings.model_id}
                disabled={saving || settings.models.length === 0}
                onChange={(e) => apply({ model_id: e.target.value })}
              >
                {settings.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="settings-group">
            <h3>Desktop IDE · execution</h3>
            <label>
              Mode
              <select
                value={settings.mode}
                disabled={saving}
                onChange={(e) => apply({ mode: e.target.value })}
              >
                <option value="plan">Plan</option>
                <option value="edit">Edit</option>
                <option value="agent">Agent</option>
              </select>
            </label>
            <label>
              Environment
              <select
                value={settings.environment}
                disabled={saving}
                onChange={(e) => apply({ environment: e.target.value })}
              >
                <option value="local">Local</option>
                <option value="cloud">Cloud</option>
                <option value="new_worktree">New Worktree</option>
              </select>
            </label>
          </section>

          <section className="settings-group">
            <h3>Desktop IDE · workspace</h3>
            <p className="hint workspace-path">{settings.workspace}</p>
            <label>
              Branch
              <select
                value={settings.selected_branch ?? ""}
                disabled={saving}
                onChange={(e) => apply({ selected_branch: e.target.value })}
              >
                <option value="">
                  {settings.current_branch
                    ? `${settings.current_branch} (current)`
                    : "Current branch"}
                </option>
                {settings.branches.map((b) => (
                  <option key={b} value={b}>
                    {b === settings.current_branch ? `${b} (current)` : b}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </>
      ) : (
        <p className="hint">Loading IDE settings…</p>
      )}

      <section className="settings-group">
        <h3>Session</h3>
        <button type="button" className="ghost" onClick={refresh} disabled={saving}>
          Refresh IDE settings
        </button>
        <button type="button" className="ghost danger" onClick={onDisconnect}>
          Disconnect from IDE
        </button>
      </section>
    </div>
  );
}
