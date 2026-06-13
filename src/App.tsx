import { useEffect, useState } from "react";
import WebApp from "@twa-dev/sdk";
import { BridgeClient, SESSION_LOST_EVENT } from "./bridge/client";
import { PairingScreen } from "./pairing/PairingScreen";
import { ChatPanel } from "./chat/ChatPanel";
import { EditorPanel } from "./editor/EditorPanel";
import { PreviewPanel } from "./preview/PreviewPanel";
import { RemotePanel } from "./remote/RemotePanel";
import { FilesPanel } from "./files/FilesPanel";
import { SettingsPanel } from "./settings/SettingsPanel";
import "./shell/App.css";

type Tab = "chat" | "editor" | "preview" | "files" | "remote" | "settings";

const TAB_LABELS: Record<Tab, string> = {
  chat: "Chat",
  editor: "Editor",
  preview: "Preview",
  files: "Files",
  remote: "Remote",
  settings: "Settings",
};

export default function App() {
  const [client, setClient] = useState<BridgeClient | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    try {
      WebApp.ready();
      WebApp.expand();
    } catch {
      /* not in Telegram */
    }
  }, []);

  // Relaunch/reload: resume a previously paired session instead of forcing a
  // re-scan. A server-side reject means the session is gone (clear it); a network
  // failure (IDE not up yet) keeps the stored session for a later retry.
  useEffect(() => {
    let cancelled = false;
    const saved = BridgeClient.restore();
    if (!saved) {
      setRestoring(false);
      return;
    }
    saved
      .connect()
      .then(
        () =>
          saved.resume().then(
            () => {
              if (!cancelled) setClient(saved);
            },
            () => {
              saved.disconnect();
            },
          ),
        () => {
          /* IDE unreachable — keep stored session, show pairing */
        },
      )
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Host revoked us or the session expired mid-use → back to pairing.
  useEffect(() => {
    if (!client) return;
    return client.on((event) => {
      if (event === SESSION_LOST_EVENT) setClient(null);
    });
  }, [client]);

  if (restoring && !client) {
    return (
      <div className="panel">
        <h2>Reconnecting…</h2>
        <p className="hint">Resuming your paired session.</p>
      </div>
    );
  }

  if (!client) {
    return <PairingScreen onPaired={setClient} />;
  }

  return (
    <div className="app">
      <nav className="tabs">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        <button
          type="button"
          className="ghost"
          onClick={() => {
            client.disconnect();
            setClient(null);
          }}
        >
          Disconnect
        </button>
      </nav>
      <main className="content">
        {tab === "chat" && <ChatPanel client={client} />}
        {tab === "editor" && <EditorPanel client={client} />}
        {tab === "preview" && <PreviewPanel client={client} />}
        {tab === "files" && <FilesPanel client={client} />}
        {tab === "remote" && <RemotePanel client={client} />}
        {tab === "settings" && <SettingsPanel client={client} />}
      </main>
    </div>
  );
}
