import { useEffect, useRef, useState } from "react";
import type { BridgeClient } from "../bridge/client";
import type { RemoteStatus } from "@protocol/schema";
// @ts-expect-error noVNC ships without TS types
import RFB from "@novnc/novnc";

type Props = { client: BridgeClient };

export function RemotePanel({ client }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<InstanceType<typeof RFB> | null>(null);
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [control, setControl] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    client.call("remote.status").then((s) => setStatus(s as RemoteStatus)).catch(() => undefined);
    return client.on((event, data) => {
      if (event === "remote.status") setStatus(data as RemoteStatus);
    });
  }, [client]);

  const startVnc = async () => {
    setError("");
    if (!client.pairResult) {
      setError("Not paired");
      return;
    }
    if (control) {
      await client.call("remote.enable");
    }
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    try {
      const rfb = new RFB(container, client.pairResult.vnc_ws_url, {
        credentials: { password: client.pairResult.vnc_password },
      });
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfbRef.current = rfb;
      rfb.addEventListener("disconnect", () => {
        rfbRef.current = null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "VNC failed");
    }
  };

  const stopVnc = async () => {
    rfbRef.current?.disconnect();
    rfbRef.current = null;
    await client.call("remote.disable").catch(() => undefined);
  };

  return (
    <div className="panel remote-panel">
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={control}
            onChange={(e) => setControl(e.target.checked)}
          />
          Control mode (desktop must allow)
        </label>
        <button type="button" onClick={startVnc}>
          Start desktop
        </button>
        <button type="button" onClick={stopVnc}>
          Stop
        </button>
      </div>
      {status && (
        <p className="hint">
          VNC: {status.vnc_running ? "running" : "stopped"} | Proxy:{" "}
          {status.proxy_active ? "active" : "idle"} | Allow:{" "}
          {status.allow_control ? "yes" : "no"}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div ref={containerRef} className="vnc-container" />
    </div>
  );
}
