import { useEffect, useState, type ReactElement } from "react";
import WebApp from "@twa-dev/sdk";
import { BridgeClient, SESSION_LOST_EVENT } from "./bridge/client";
import { PairingScreen } from "./pairing/PairingScreen";
import { ChatPanel } from "./chat/ChatPanel";
import { TerminalsPanel } from "./terminals/TerminalsPanel";
import { RemotePanel } from "./remote/RemotePanel";
import { SettingsPanel } from "./settings/SettingsPanel";
import { applyPrefs, loadPrefs } from "./settings/webPrefs";
import "./shell/App.css";

type Tab = "chat" | "terminals" | "remote" | "settings";

const TABS: Array<{ id: Tab; label: string; icon: ReactElement }> = [
  {
    id: "chat",
    label: "Chat",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H9.4L5.7 19.7A1 1 0 0 1 4 19v-3.1A2.5 2.5 0 0 1 4 13.5v-8Z" />
      </svg>
    ),
  },
  {
    id: "terminals",
    label: "Terminals",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.5 4h17A1.5 1.5 0 0 1 22 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18.5v-13A1.5 1.5 0 0 1 3.5 4Zm2.6 4.2a1 1 0 0 0 0 1.6L8.4 12l-2.3 2.2a1 1 0 1 0 1.4 1.5l3.2-3a1 1 0 0 0 0-1.4l-3.2-3a1 1 0 0 0-1.4-.1ZM12 15a1 1 0 1 0 0 2h5a1 1 0 1 0 0-2h-5Z" />
      </svg>
    ),
  },
  {
    id: "remote",
    label: "Remote",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6v1.5h2a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h2V17H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v9h16V6H4Z" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10.8 3.1a1 1 0 0 1 1-.8h.4a1 1 0 0 1 1 .8l.3 1.6c.6.2 1.2.5 1.7 1l1.5-.6a1 1 0 0 1 1.2.4l.2.4a1 1 0 0 1-.2 1.3l-1.2 1c.1.6.1 1.2 0 1.8l1.2 1a1 1 0 0 1 .2 1.3l-.2.4a1 1 0 0 1-1.2.4l-1.5-.6a6 6 0 0 1-1.7 1l-.3 1.6a1 1 0 0 1-1 .8h-.4a1 1 0 0 1-1-.8l-.3-1.6a6 6 0 0 1-1.7-1l-1.5.6a1 1 0 0 1-1.2-.4l-.2-.4a1 1 0 0 1 .2-1.3l1.2-1a6.3 6.3 0 0 1 0-1.8l-1.2-1a1 1 0 0 1-.2-1.3l.2-.4a1 1 0 0 1 1.2-.4l1.5.6c.5-.5 1.1-.8 1.7-1l.3-1.6ZM12 14a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" transform="translate(0 2.5)" />
      </svg>
    ),
  },
];

export default function App() {
  const [client, setClient] = useState<BridgeClient | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    applyPrefs(loadPrefs());
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
      <main className="content">
        {tab === "chat" && <ChatPanel client={client} />}
        {tab === "terminals" && <TerminalsPanel client={client} />}
        {tab === "remote" && <RemotePanel client={client} />}
        {tab === "settings" && (
          <SettingsPanel
            client={client}
            onDisconnect={() => {
              client.disconnect();
              setClient(null);
            }}
          />
        )}
      </main>
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
