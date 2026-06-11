import { useCallback, useEffect, useState } from "react";
import type { BridgeClient } from "../bridge/client";
import type { BridgeSettings } from "@protocol/schema";

type Props = { client: BridgeClient };

/** Mirrors the IDE pill bar: provider, model, environment, and git branch. */
export function SettingsPanel({ client }: Props) {
  const [settings, setSettings] = useState<BridgeSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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

  if (!settings) {
    return (
      <div className="panel">
        <p className="hint">Loading settings…</p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="panel settings-panel">
      <h2>Settings</h2>
      {error && <p className="error">{error}</p>}

      <section className="settings-group">
        <h3>Provider</h3>
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
        <h3>Execution</h3>
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
        <h3>Workspace</h3>
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

      <button type="button" className="ghost" onClick={refresh} disabled={saving}>
        Refresh
      </button>
    </div>
  );
}
