import { useState } from "react";
import WebApp from "@twa-dev/sdk";
import { BridgeClient } from "../bridge/client";
import type { BridgeClient as BridgeClientType } from "../bridge/client";

type QrPayload = {
  host: string;
  port: number;
  vnc_port?: number;
  token: string;
  bridge_wss?: string;
  vnc_wss?: string;
  off_lan_ready?: boolean;
};

type Props = {
  onPaired: (client: BridgeClientType) => void;
};

function parseQr(text: string): QrPayload | null {
  try {
    const data = JSON.parse(text) as QrPayload;
    if (!data.token) return null;
    return data;
  } catch {
    return null;
  }
}

// Telegram's in-app scanner needs Bot API 6.4+ and a real Telegram client.
const canScanInTelegram = (() => {
  try {
    return WebApp.platform !== "unknown" && WebApp.isVersionAtLeast("6.4");
  } catch {
    return false;
  }
})();

export function PairingScreen({ onPaired }: Props) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("9473");
  const [token, setToken] = useState("");
  const [bridgeWss, setBridgeWss] = useState("");
  const [offLanReady, setOffLanReady] = useState(false);
  const [qrRaw, setQrRaw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const applyQr = (raw?: string) => {
    const text = (raw ?? qrRaw).trim();
    if (!text) return null;
    const data = parseQr(text);
    if (!data) {
      setError("Invalid QR JSON");
      return null;
    }
    setHost(data.host);
    setPort(String(data.port));
    setToken(data.token);
    setBridgeWss(data.bridge_wss ?? "");
    setOffLanReady(Boolean(data.off_lan_ready));
    setError("");
    return data;
  };

  const connectWith = async (p: {
    bridgeWss: string;
    host: string;
    port: number;
    token: string;
  }) => {
    setBusy(true);
    setError("");
    try {
      if (p.bridgeWss) {
        const client = new BridgeClient("", 0, p.bridgeWss);
        await client.connect();
        await client.pair(p.token);
        onPaired(client);
        return;
      }
      if (!p.host) {
        setError("QR missing tunnel URL — enable Off-LAN in IDE or use same WiFi host");
        return;
      }
      const client = new BridgeClient(p.host, p.port);
      await client.connect();
      await client.pair(p.token);
      onPaired(client);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Connect failed — wait for IDE off-LAN ready, then retry",
      );
    } finally {
      setBusy(false);
    }
  };

  // One-tap flow: Telegram's native scanner reads the IDE pairing QR and we
  // connect immediately, no typing or pasting.
  const scanWithTelegram = () => {
    setError("");
    try {
      WebApp.showScanQrPopup(
        { text: "Scan the QR in IDE Settings → Remote" },
        (text: string) => {
          const data = applyQr(text);
          if (!data) return; // keep scanning
          void connectWith({
            bridgeWss: (data.bridge_wss ?? "").trim(),
            host: (data.host ?? "").trim(),
            port: Number(data.port) || 9473,
            token: data.token.trim(),
          });
          return true; // close the popup
        },
      );
    } catch {
      setError("QR scanner unavailable — paste the QR JSON below instead.");
    }
  };

  const pair = () => {
    if (!token.trim()) {
      setError("Paste or scan the QR from IDE Settings → Remote");
      return;
    }
    void connectWith({
      bridgeWss: bridgeWss.trim(),
      host: host.trim(),
      port: Number(port),
      token: token.trim(),
    });
  };

  const usingTunnel = Boolean(bridgeWss.trim());

  return (
    <div className="panel">
      <h2>Pair with IDE</h2>
      <p className="hint">
        In the IDE, open Settings → Remote and enable the bridge, then scan its QR here.
      </p>
      {canScanInTelegram && (
        <button type="button" disabled={busy} onClick={scanWithTelegram}>
          {busy ? "Connecting…" : "Scan QR"}
        </button>
      )}
      <details open={!canScanInTelegram}>
        <summary className="hint">Manual pairing</summary>
        <textarea
          placeholder="Paste QR JSON from IDE, or scan with your camera app"
          value={qrRaw}
          onChange={(e) => setQrRaw(e.target.value)}
          onBlur={() => applyQr()}
          rows={3}
        />
        <button type="button" onClick={() => applyQr()}>
          Parse QR
        </button>
        {usingTunnel ? (
          <p className="hint">
            {offLanReady
              ? "Secure off-LAN tunnel detected — tap Connect."
              : "Tunnel starting on IDE… connect may work on retry in ~10s."}
          </p>
        ) : (
          <p className="hint">LAN mode — same WiFi as your PC.</p>
        )}
        {!usingTunnel && (
          <>
            <label>
              Host
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.x.x"
              />
            </label>
            <label>
              Port
              <input value={port} onChange={(e) => setPort(e.target.value)} />
            </label>
          </>
        )}
        <label>
          Token
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="6-digit OTP"
          />
        </label>
        <button type="button" disabled={busy || !token} onClick={pair}>
          {busy ? "Connecting…" : "Connect"}
        </button>
      </details>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
