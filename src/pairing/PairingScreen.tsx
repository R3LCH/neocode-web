import { useEffect, useRef, useState } from "react";
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
  let raw = text.trim();
  // URL-format QR (the bridge serves this app over LAN http):
  // http://<ip>:9473/#pair=<percent-encoded JSON>
  const pairIdx = raw.indexOf("#pair=");
  if (pairIdx !== -1) {
    try {
      raw = decodeURIComponent(raw.slice(pairIdx + "#pair=".length));
    } catch {
      return null;
    }
  }
  try {
    const data = JSON.parse(raw) as QrPayload;
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
  // Served from the bridge itself (LAN http) the right host is simply ours.
  const [host, setHost] = useState(
    window.location.protocol === "http:" ? window.location.hostname : "",
  );
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
      // HTTPS pages (Telegram requires HTTPS) can only open wss:// — plain
      // ws:// to a LAN IP is blocked by the browser as mixed content.
      if (window.location.protocol === "https:") {
        setError(
          "The QR has no tunnel URL yet. In the IDE (Settings → Remote), wait until the status shows “Off-LAN: ready”, click Regenerate, then scan the new QR.",
        );
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

  // Zero-tap flow: when the bridge serves this app over LAN http, the QR is a
  // URL carrying the pairing payload in its fragment — opening it lands here
  // and we pair immediately. The fragment never leaves the browser; we still
  // scrub the one-time token from the address bar right away.
  const autoPaired = useRef(false);
  useEffect(() => {
    if (autoPaired.current) return;
    const hash = window.location.hash;
    if (!hash.startsWith("#pair=")) return;
    autoPaired.current = true;
    const data = applyQr(hash);
    window.history.replaceState(null, "", window.location.pathname);
    if (!data) return;
    void connectWith({
      bridgeWss: (data.bridge_wss ?? "").trim(),
      host: (data.host ?? "").trim() || window.location.hostname,
      port: Number(data.port) || 9473,
      token: data.token.trim(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div className="pairing-screen">
      <div className="pairing-card">
        <div className="pairing-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6v1.5h2a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h2V17H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2.6 4.2a1 1 0 0 0-.1 1.5L8.4 11.5 6.5 13.3a1 1 0 1 0 1.4 1.5l2.7-2.6a1 1 0 0 0 0-1.4L7.9 8.2a1 1 0 0 0-1.3 0ZM12 13a1 1 0 1 0 0 2h4a1 1 0 1 0 0-2h-4Z" />
          </svg>
        </div>
        <h1>NeoCode Remote</h1>
        <p className="hint pairing-sub">
          Control your IDE from this device. Open <strong>Settings → Remote</strong> in
          the IDE, enable the bridge, then scan its QR.
        </p>

        {canScanInTelegram && (
          <button
            type="button"
            className="pairing-scan"
            disabled={busy}
            onClick={scanWithTelegram}
          >
            {busy ? "Connecting…" : "Scan QR"}
          </button>
        )}

        <details className="pairing-manual" open={!canScanInTelegram}>
          <summary>Manual pairing</summary>
          <div className="pairing-manual-body">
            <textarea
              placeholder="Paste QR contents (URL or JSON) from IDE, or scan with your camera app"
              value={qrRaw}
              onChange={(e) => setQrRaw(e.target.value)}
              onBlur={() => applyQr()}
              rows={3}
            />
            <button type="button" className="ghost" onClick={() => applyQr()}>
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
              <div className="row">
                <label>
                  Host
                  <input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="192.168.x.x"
                  />
                </label>
                <label className="pairing-port">
                  Port
                  <input value={port} onChange={(e) => setPort(e.target.value)} />
                </label>
              </div>
            )}
            <label>
              Token
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="6-digit OTP"
                inputMode="numeric"
              />
            </label>
            <button type="button" disabled={busy || !token} onClick={pair}>
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </details>

        {error && <p className="error pairing-error">{error}</p>}
      </div>
    </div>
  );
}
