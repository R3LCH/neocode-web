import { useEffect, useRef, useState } from "react";
import type { BridgeClient } from "../bridge/client";
// @ts-expect-error noVNC ships without TS types
import RFB from "@novnc/novnc";

type Props = { client: BridgeClient };

export function RemotePanel({ client }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const kbdRef = useRef<HTMLTextAreaElement>(null);
  const rfbRef = useRef<InstanceType<typeof RFB> | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  // Keep the screen above the on-screen keyboard: the visual viewport shrinks
  // when the soft keyboard opens, so mirror its height onto the app shell.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () =>
      document.documentElement.style.setProperty("--vvh", `${vv.height}px`);
    apply();
    vv.addEventListener("resize", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--vvh");
    };
  }, []);

  const startVnc = async () => {
    setError("");
    if (!client.pairResult) {
      setError("Not paired");
      return;
    }
    try {
      await client.call("remote.enable");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Desktop refused screen share (turn on Screen share on the desktop)",
      );
      return;
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
      let handshaken = false;
      setError("Connecting to desktop…");
      rfb.addEventListener("connect", () => {
        handshaken = true;
        setError("");
        setConnected(true);
        applyZoom(false);
      });
      rfb.addEventListener("securityfailure", (ev: { detail?: { reason?: string } }) => {
        setError(ev.detail?.reason || "VNC authentication failed");
      });
      rfb.addEventListener("disconnect", (ev: { detail?: { clean?: boolean } }) => {
        rfbRef.current = null;
        setConnected(false);
        if (!handshaken) {
          setError(
            "Connected to the desktop but no screen came through. On the desktop, stop the TightVNC service or run the app as administrator, then retry.",
          );
        } else if (ev.detail?.clean === false) {
          setError("Screen disconnected — is the desktop screen share on?");
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "VNC failed");
    }
  };

  const stopVnc = async () => {
    rfbRef.current?.disconnect();
    rfbRef.current = null;
    setConnected(false);
    await client.call("remote.disable").catch(() => undefined);
  };

  // Fit = scale the whole desktop into the panel. Zoom = native resolution,
  // clipped, with drag-to-pan so you can read a landscape desktop up close.
  const applyZoom = (next: boolean) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.scaleViewport = !next;
    rfb.clipViewport = next;
    rfb.dragViewport = next;
    setZoomed(next);
  };

  const showKeyboard = () => kbdRef.current?.focus();

  const onKbdKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    const keysym = SPECIAL_KEYSYMS[e.key];
    if (keysym) {
      rfb.sendKey(keysym, e.code, true);
      rfb.sendKey(keysym, e.code, false);
      e.preventDefault();
    }
  };

  const onKbdInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const rfb = rfbRef.current;
    const data = (e.nativeEvent as InputEvent).data;
    if (rfb && data) {
      for (const ch of data) {
        const cp = ch.codePointAt(0)!;
        const keysym = cp < 0x100 ? cp : 0x01000000 + cp;
        rfb.sendKey(keysym, null, true);
        rfb.sendKey(keysym, null, false);
      }
    }
    // Don't let the textarea accumulate text — it's only a soft-keyboard tap.
    if (kbdRef.current) kbdRef.current.value = "";
  };

  return (
    <div className="panel remote-panel">
      <div className="vnc-stage">
        <div ref={containerRef} className="vnc-container" />
        {connected ? (
          <div className="vnc-overlay">
            <button type="button" onClick={showKeyboard} title="Keyboard">
              ⌨
            </button>
            <button type="button" onClick={() => applyZoom(!zoomed)} title="Zoom">
              {zoomed ? "Fit" : "Zoom"}
            </button>
            <button type="button" onClick={stopVnc} title="Disconnect screen">
              Stop
            </button>
          </div>
        ) : (
          <div className="vnc-start">
            <button type="button" onClick={startVnc}>
              Start desktop
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        )}
        {connected && error && <p className="vnc-banner error">{error}</p>}
        <textarea
          ref={kbdRef}
          className="vnc-kbd"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={onKbdKeyDown}
          onInput={onKbdInput}
        />
      </div>
    </div>
  );
}

// X11 keysyms for the non-printable keys a soft keyboard emits.
const SPECIAL_KEYSYMS: Record<string, number> = {
  Enter: 0xff0d,
  Backspace: 0xff08,
  Tab: 0xff09,
  Escape: 0xff1b,
  Delete: 0xffff,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
};
