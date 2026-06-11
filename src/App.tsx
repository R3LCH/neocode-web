import { useEffect, useState } from "react";
import WebApp from "@twa-dev/sdk";
import type { BridgeClient } from "./bridge/client";
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

  useEffect(() => {
    try {
      WebApp.ready();
      WebApp.expand();
    } catch {
      /* not in Telegram */
    }
  }, []);

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
