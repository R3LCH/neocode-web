import { useEffect, useMemo, useRef, useState } from "react";
import type { BridgeClient } from "../bridge/client";
import type { ApprovalSnapshot, ChatThreadSnapshot } from "@protocol/schema";

type Props = { client: BridgeClient };

export function ChatPanel({ client }: Props) {
  const [threads, setThreads] = useState<ChatThreadSnapshot[]>([]);
  const [approvals, setApprovals] = useState<ApprovalSnapshot[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"plan" | "edit" | "agent">("agent");
  const [streaming, setStreaming] = useState("");
  const [sending, setSending] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    client
      .call<ChatThreadSnapshot[]>("chat.threads")
      .then((t) => {
        setThreads(t);
        setActiveId((id) => id ?? t.find((th) => th.active)?.id ?? null);
      })
      .catch(() => undefined);
    return client.on((event, data) => {
      if (event === "chat.progress") {
        const p = data as { message?: string; response?: string };
        setStreaming(p.response ?? p.message ?? "");
      }
      if (event === "chat.threads") setThreads(data as ChatThreadSnapshot[]);
      if (event === "chat.approvals") setApprovals(data as ApprovalSnapshot[]);
    });
  }, [client]);

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
    if (!query.trim() || sending) return;
    setSending(true);
    setStreaming("…");
    try {
      await callSafe("chat.send", {
        query: query.trim(),
        mode,
        thread_id: active?.id,
      });
      setQuery("");
      const t = (await client.call("chat.threads")) as ChatThreadSnapshot[];
      setThreads(t);
    } finally {
      setStreaming("");
      setSending(false);
    }
  };

  const respondApproval = async (id: string, approved: boolean) => {
    await callSafe(approved ? "chat.approve" : "chat.deny", { id });
  };

  const threadRow = (t: ChatThreadSnapshot) => (
    <div key={t.id} className={`thread-row${t.id === active?.id ? " selected" : ""}`}>
      <button type="button" className="thread-title" onClick={() => selectThread(t.id)}>
        <span>{t.title}</span>
        <span className="thread-status">{t.status}</span>
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
          {active && <span className="thread-status">{active.status}</span>}
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
        <div className="mode-chips">
          {(["plan", "edit", "agent"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`chip${mode === m ? " active" : ""}`}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="composer-row">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask the assistant…"
            rows={2}
          />
          <div className="composer-buttons">
            <button type="button" onClick={send} disabled={sending || !query.trim()}>
              Send
            </button>
            {active?.status === "Running" && (
              <button
                type="button"
                className="ghost danger"
                onClick={() => callSafe("chat.stop", { thread_id: active?.id })}
              >
                Stop
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
