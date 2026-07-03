import { useEffect, useMemo, useRef, useState } from "react";
import type { BridgeClient } from "../bridge/client";
import type {
  ApprovalSnapshot,
  BridgeSettings,
  ChatThreadSnapshot,
} from "@protocol/schema";
import { threadStateColor, THREAD_STATES } from "../notifications";

type Props = { client: BridgeClient };

// Compact inline icons for the pill bar — replaces the MODE/PROVIDER/… text.
function PillIcon({ d, title }: { d: string; title: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-label={title} className="pill-icon">
      <title>{title}</title>
      <path d={d} />
    </svg>
  );
}

const ICON_PATHS = {
  // sliders → mode
  mode: "M4 6h10a3 3 0 1 0 0-2H4a1 1 0 1 0 0 2Zm16-2h-2a1 1 0 1 0 0 2h2a1 1 0 1 0 0-2ZM4 13h2a3 3 0 1 0 0-2H4a1 1 0 1 0 0 2Zm16-2H10a1 1 0 1 0 0 2h10a1 1 0 1 0 0-2ZM4 20h10a3 3 0 1 0 0-2H4a1 1 0 1 0 0 2Zm16-2h-2a1 1 0 1 0 0 2h2a1 1 0 1 0 0-2Z",
  // cpu chip → provider
  provider:
    "M9 2a1 1 0 0 1 2 0v2h2V2a1 1 0 1 1 2 0v2h1a3 3 0 0 1 3 3v1h2a1 1 0 1 1 0 2h-2v2h2a1 1 0 1 1 0 2h-2v1a3 3 0 0 1-3 3h-1v2a1 1 0 1 1-2 0v-2h-2v2a1 1 0 1 1-2 0v-2H8a3 3 0 0 1-3-3v-1H3a1 1 0 1 1 0-2h2v-2H3a1 1 0 1 1 0-2h2V7a3 3 0 0 1 3-3h1V2Zm0 7a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H9Z",
  // sparkle → model
  model:
    "M12 3l1.7 4.6a3 3 0 0 0 1.8 1.8L20 11l-4.5 1.7a3 3 0 0 0-1.8 1.8L12 19l-1.7-4.5a3 3 0 0 0-1.8-1.8L4 11l4.5-1.6a3 3 0 0 0 1.8-1.8L12 3ZM5 18l.8 2.2L8 21l-2.2.8L5 24l-.8-2.2L2 21l2.2-.8L5 18Z",
  // stacked layers → env
  env: "M12 3l9 4.5-9 4.5-9-4.5L12 3Zm-6.7 8.1L12 14.4l6.7-3.3L21 12l-9 4.5L3 12l2.3-.9Zm0 4.5L12 18.9l6.7-3.3L21 16.5 12 21l-9-4.5 2.3-.9Z",
  // git branch → branch
  branch:
    "M7 3a3 3 0 0 1 1 5.83v6.34a3 3 0 1 1-2 0V8.83A3 3 0 0 1 7 3Zm10 0a3 3 0 0 1 1 5.83c-.2 3.14-2.6 4.6-5.4 5.06a3 3 0 1 1-.34-1.98c2.3-.4 3.55-1.42 3.74-3.1A3 3 0 0 1 17 3Z",
} as const;

export function ChatPanel({ client }: Props) {
  const [threads, setThreads] = useState<ChatThreadSnapshot[]>([]);
  const [approvals, setApprovals] = useState<ApprovalSnapshot[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<BridgeSettings | null>(null);
  const [streaming, setStreaming] = useState("");
  const [sending, setSending] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attaching, setAttaching] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    client
      .call<ChatThreadSnapshot[]>("chat.threads")
      .then((t) => {
        setThreads(t);
        setActiveId((id) => id ?? t.find((th) => th.active)?.id ?? null);
      })
      .catch(() => undefined);
    client
      .call<BridgeSettings>("settings.get")
      .then(setSettings)
      .catch(() => undefined);
    return client.on((event, data) => {
      if (event === "chat.progress") {
        const p = data as { message?: string; response?: string };
        setStreaming(p.response ?? p.message ?? "");
      }
      if (event === "chat.threads") setThreads(data as ChatThreadSnapshot[]);
      if (event === "chat.approvals") setApprovals(data as ApprovalSnapshot[]);
      if (event === "settings.changed") setSettings(data as BridgeSettings);
    });
  }, [client]);

  // Pill bar — mirrors the IDE AI overlay: mode / provider / model / env / branch.
  const applySettings = async (patch: Record<string, unknown>) => {
    setError("");
    try {
      const next = await client.call<BridgeSettings>("settings.set", patch);
      setSettings(next);
    } catch (e) {
      setError(String(e));
    }
  };

  const visibleThreads = useMemo(
    () => threads.filter((t) => !t.archived),
    [threads],
  );
  const archivedThreads = useMemo(
    () => threads.filter((t) => t.archived),
    [threads],
  );
  const active =
    threads.find((t) => t.id === activeId) ??
    visibleThreads.find((t) => t.active) ??
    visibleThreads[0];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [active?.messages.length, streaming]);

  const callSafe = async (method: string, params?: Record<string, unknown>) => {
    setError("");
    try {
      return await client.call(method, params);
    } catch (e) {
      setError(String(e));
      return null;
    }
  };

  const selectThread = async (id: string) => {
    setActiveId(id);
    setShowThreads(false);
    await callSafe("chat.thread_set_active", { thread_id: id });
  };

  const newThread = async () => {
    const res = (await callSafe("chat.thread_new")) as { thread_id?: string } | null;
    if (res?.thread_id) {
      setActiveId(res.thread_id);
      setShowThreads(false);
    }
  };

  const renameThread = async (t: ChatThreadSnapshot) => {
    const title = window.prompt("Rename thread", t.title);
    if (title?.trim()) {
      await callSafe("chat.thread_rename", { thread_id: t.id, title: title.trim() });
    }
  };

  const archiveThread = async (t: ChatThreadSnapshot, archived: boolean) => {
    await callSafe("chat.thread_archive", { thread_id: t.id, archived });
  };

  const deleteThread = async (t: ChatThreadSnapshot) => {
    if (window.confirm(`Delete "${t.title}" permanently?`)) {
      await callSafe("chat.thread_delete", { thread_id: t.id });
      if (activeId === t.id) setActiveId(null);
    }
  };

  const send = async () => {
    if ((!query.trim() && attachments.length === 0) || sending) return;
    setSending(true);
    setStreaming("…");
    try {
      let text = query.trim();
      if (attachments.length > 0) {
        const listing = attachments.map((p) => `- ${p}`).join("\n");
        text = `${text}\n\nAttached context files:\n${listing}`.trim();
      }
      await callSafe("chat.send", {
        query: text,
        mode: settings?.mode ?? "agent",
        thread_id: active?.id,
      });
      setQuery("");
      setAttachments([]);
      const t = (await client.call("chat.threads")) as ChatThreadSnapshot[];
      setThreads(t);
    } finally {
      setStreaming("");
      setSending(false);
    }
  };

  // Upload files/photos from the phone into the workspace's .claw-context dir;
  // the returned paths ride along with the next message.
  const attachFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttaching(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const buf = await file.arrayBuffer();
        let binary = "";
        const bytes = new Uint8Array(buf);
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        const res = (await client.call("chat.attach", {
          name: file.name,
          data_base64: btoa(binary),
        })) as { path?: string };
        if (res?.path) setAttachments((a) => [...a, res.path!]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const respondApproval = async (id: string, approved: boolean) => {
    await callSafe(approved ? "chat.approve" : "chat.deny", { id });
  };

  const statusDot = (status: string) => (
    <span
      className="status-dot"
      title={THREAD_STATES[status]?.label ?? status}
      style={{ background: threadStateColor(status) }}
    />
  );

  const threadRow = (t: ChatThreadSnapshot) => (
    <div key={t.id} className={`thread-row${t.id === active?.id ? " selected" : ""}`}>
      <button type="button" className="thread-title" onClick={() => selectThread(t.id)}>
        <span>{t.title}</span>
        <span className="thread-status">
          {statusDot(t.status)}
          {THREAD_STATES[t.status]?.label ?? t.status}
        </span>
      </button>
      <div className="thread-actions">
        <button type="button" className="ghost" onClick={() => renameThread(t)} title="Rename">
          Rename
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => archiveThread(t, !t.archived)}
          title={t.archived ? "Unarchive" : "Archive"}
        >
          {t.archived ? "Unarchive" : "Archive"}
        </button>
        <button type="button" className="ghost danger" onClick={() => deleteThread(t)} title="Delete">
          Delete
        </button>
      </div>
    </div>
  );

  return (
    <div className="panel chat-panel">
      <header className="chat-header">
        <button type="button" className="ghost" onClick={() => setShowThreads((v) => !v)}>
          {showThreads ? "Close" : "Threads"}
        </button>
        <div className="chat-title">
          <strong>{active?.title ?? "No thread"}</strong>
          {active && (
            <span className="thread-status">
              {statusDot(active.status)}
              {THREAD_STATES[active.status]?.label ?? active.status}
            </span>
          )}
        </div>
        <button type="button" className="ghost" onClick={newThread}>
          New
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      {showThreads && (
        <div className="thread-drawer">
          {visibleThreads.map(threadRow)}
          {visibleThreads.length === 0 && <p className="hint">No threads yet.</p>}
          {archivedThreads.length > 0 && (
            <button
              type="button"
              className="ghost archived-toggle"
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? "Hide" : "Show"} archived ({archivedThreads.length})
            </button>
          )}
          {showArchived && archivedThreads.map(threadRow)}
        </div>
      )}

      {approvals.length > 0 && (
        <div className="approvals">
          <h3>Pending approvals</h3>
          {approvals.map((a) => (
            <div key={a.id} className="approval-card">
              <strong>
                {a.server_name} / {a.tool_name}
              </strong>
              <pre>{a.arguments}</pre>
              <div className="row">
                <button type="button" onClick={() => respondApproval(a.id, true)}>
                  Approve
                </button>
                <button type="button" className="ghost danger" onClick={() => respondApproval(a.id, false)}>
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {settings?.provider_id === "claude-code" && (
        <p className="hint shell-hint">
          Claude Code runs as an interactive shell on the desktop. Messages you
          send here are typed straight into it — watch the session in the
          Terminals tab (chip named “Claude Code Shell”).
        </p>
      )}

      <div className="messages">
        {active?.messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <pre>{m.content}</pre>
          </div>
        ))}
        {streaming && (
          <div className="msg msg-agent streaming">
            <pre>{streaming}</pre>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="composer">
        {settings && (
          <div className="pill-bar">
            <label className="pill">
              <PillIcon d={ICON_PATHS.mode} title="Mode" />
              <select
                value={settings.mode}
                onChange={(e) => applySettings({ mode: e.target.value })}
              >
                <option value="plan">Plan</option>
                <option value="edit">Edit</option>
                <option value="agent">Agent</option>
              </select>
            </label>
            <label className="pill">
              <PillIcon d={ICON_PATHS.provider} title="Provider" />
              <select
                value={settings.provider_id}
                onChange={(e) => applySettings({ provider_id: e.target.value })}
              >
                {settings.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="pill">
              <PillIcon d={ICON_PATHS.model} title="Model" />
              <select
                value={settings.model_id}
                disabled={settings.models.length === 0}
                onChange={(e) => applySettings({ model_id: e.target.value })}
              >
                {settings.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="pill">
              <PillIcon d={ICON_PATHS.env} title="Environment" />
              <select
                value={settings.environment}
                onChange={(e) => applySettings({ environment: e.target.value })}
              >
                <option value="local">Local</option>
                <option value="cloud">Cloud</option>
                <option value="new_worktree">Worktree</option>
              </select>
            </label>
            <label className="pill">
              <PillIcon d={ICON_PATHS.branch} title="Branch" />
              <select
                value={settings.selected_branch ?? ""}
                onChange={(e) => applySettings({ selected_branch: e.target.value })}
              >
                <option value="">
                  {settings.current_branch
                    ? `${settings.current_branch} (current)`
                    : "current"}
                </option>
                {settings.branches.map((b) => (
                  <option key={b} value={b}>
                    {b === settings.current_branch ? `${b} (current)` : b}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="attachment-chips">
            {attachments.map((p) => (
              <span key={p} className="attachment-chip">
                {p.split(/[\\/]/).pop()}
                <button
                  type="button"
                  className="attachment-remove"
                  onClick={() =>
                    setAttachments((a) => a.filter((x) => x !== p))
                  }
                  aria-label="Remove attachment"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-box">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => void attachFiles(e.target.files)}
          />
          <button
            type="button"
            className="composer-icon attach"
            disabled={attaching}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Add context from this device"
            title="Add context (files, photos)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H6a1 1 0 1 1 0-2h5V6a1 1 0 0 1 1-1Z" />
            </svg>
          </button>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={attaching ? "Uploading…" : "Ask the assistant…"}
            rows={2}
          />
          {active?.status === "Running" ? (
            <button
              type="button"
              className="composer-icon stop"
              onClick={() => callSafe("chat.stop", { thread_id: active?.id })}
              aria-label="Stop"
              title="Stop"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="7" y="7" width="10" height="10" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="composer-icon send"
              onClick={send}
              disabled={sending || (!query.trim() && attachments.length === 0)}
              aria-label="Send"
              title="Send"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3.4 20.4 21.2 12 3.4 3.6v6.5L15 12 3.4 13.9v6.5Z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
