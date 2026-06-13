import { useEffect, useRef, useState } from "react";
import type { BridgeClient } from "../bridge/client";
// @ts-expect-error noVNC ships without TS types
import RFB from "@novnc/novnc";

type Props = { client: BridgeClient };

export function RemotePanel({ client }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const kbdRef = useRef<HTMLTextAreaElement>(null);
  const rfbRef = useRef<InstanceType<typeof RFB> | null>(null);
  const resetViewRef = useRef<() => void>(() => undefined);
  const setRotatedRef = useRef<(on: boolean) => void>(() => undefined);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [mods, setMods] = useState<number[]>([]);

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

  // Pinch-to-zoom (in and out) and manual rotate. Zoom drives noVNC's own
  // _display.scale (not a CSS transform) so the pointer mapping stays accurate
  // — absX divides client coords by _display.scale, which a CSS scale wouldn't
  // change. We pair it with clipViewport + dragViewport so the enlarged desktop
  // can be panned by dragging, and tapping still clicks the right pixel.
  useEffect(() => {
    const stage = stageRef.current;
    const zoom = zoomRef.current;
    const container = containerRef.current;
    if (!stage || !zoom || !container) return;

    let rotated = false;
    let active = false;
    let zoomMode = false;
    let fitScale = 0; // noVNC scale at fit — the zoom-out floor
    let curZoom = 0; // current _display.scale while zoomed
    let startDist = 0;
    let startScale = 1;

    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const display = () => rfbRef.current?._display;

    const enterZoom = () => {
      const rfb = rfbRef.current;
      if (zoomMode || !rfb) return;
      zoomMode = true;
      rfb.scaleViewport = false; // stop autoscale; we set the scale ourselves
      rfb.clipViewport = true; // limit the viewport so it can be panned
      rfb.dragViewport = true; // one-finger drag pans, tap still clicks
    };
    const exitZoom = () => {
      const rfb = rfbRef.current;
      zoomMode = false;
      curZoom = 0;
      if (!rfb) return;
      rfb.dragViewport = false;
      rfb.clipViewport = false;
      rfb.scaleViewport = true; // back to fit
    };

    // Rotate 90° clockwise (desktop left edge → top, right → bottom) and scale
    // UP to fill the panel vertically. We do NOT resize the noVNC box: its
    // _screenSize uses getBoundingClientRect, which would report the rotated
    // (swapped-back) size and refit small — a bare flip. Instead we leave the
    // fit untouched and enlarge with a transform about the centre. View-only
    // here (rotation breaks tap→pixel mapping).
    const applyRotation = () => {
      const cv = container.querySelector("canvas");
      if (!cv || !cv.clientWidth) return;
      // After rotation the desktop's displayed width spans the panel height.
      const k = stage.clientHeight / cv.clientWidth;
      zoom.style.transformOrigin = "center center";
      zoom.style.transform = `rotate(90deg) scale(${k})`;
    };

    setRotatedRef.current = (on: boolean) => {
      rotated = on;
      if (on) {
        if (zoomMode) exitZoom();
        container.style.pointerEvents = "none";
        applyRotation();
        // The viewport can settle a beat later (e.g. keyboard), so recompute.
        setTimeout(applyRotation, 350);
      } else {
        container.style.pointerEvents = "";
        zoom.style.transform = "";
        zoom.style.transformOrigin = "";
      }
    };

    resetViewRef.current = () => {
      if (zoomMode) exitZoom();
    };

    const onResize = () => {
      if (rotated) applyRotation();
      else if (zoomMode) {
        const d = display();
        if (d) d.scale = curZoom; // noVNC resets scale on resize; re-apply
      }
    };
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    const onStart = (e: TouchEvent) => {
      if (rotated || e.touches.length !== 2) return;
      active = true;
      startDist = dist(e.touches);
      startScale = display()?.scale ?? 1;
      if (!zoomMode) fitScale = startScale;
      e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
      if (rotated || !active || e.touches.length !== 2) return;
      e.preventDefault();
      const target = (startScale * dist(e.touches)) / startDist;
      if (target <= fitScale * 1.05) {
        if (zoomMode) exitZoom(); // pinched back to fit → restore autoscale
        return;
      }
      enterZoom();
      const d = display();
      if (d) {
        curZoom = Math.min(target, fitScale * 8);
        d.scale = curZoom;
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) active = false;
    };

    stage.addEventListener("touchstart", onStart, { passive: false });
    stage.addEventListener("touchmove", onMove, { passive: false });
    stage.addEventListener("touchend", onEnd);
    stage.addEventListener("touchcancel", onEnd);
    return () => {
      stage.removeEventListener("touchstart", onStart);
      stage.removeEventListener("touchmove", onMove);
      stage.removeEventListener("touchend", onEnd);
      stage.removeEventListener("touchcancel", onEnd);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [connected]);

  // Rotation is a manual toggle: default is normal landscape (taps = mouse),
  // the Rotate button fills the panel vertically (view-only — see setRotatedRef).
  useEffect(() => {
    setRotatedRef.current(connected && rotated);
  }, [rotated, connected]);

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
        resetViewRef.current();
      });
      rfb.addEventListener("securityfailure", (ev: { detail?: { reason?: string } }) => {
        setError(ev.detail?.reason || "VNC authentication failed");
      });
      rfb.addEventListener("disconnect", (ev: { detail?: { clean?: boolean } }) => {
        rfbRef.current = null;
        setConnected(false);
        setMods([]);
        setRotated(false);
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
    setMods([]);
    setRotated(false);
    await client.call("remote.disable").catch(() => undefined);
  };

  // Sticky modifiers: tapping Ctrl/Alt/Shift holds it down on the remote, then
  // the next key (typed or a special-key button) sends the combo and releases
  // every held modifier — so "Ctrl" then "k" sends Ctrl+K.
  const toggleMod = (keysym: number) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    setMods((cur) => {
      if (cur.includes(keysym)) {
        rfb.sendKey(keysym, null, false);
        return cur.filter((m) => m !== keysym);
      }
      rfb.sendKey(keysym, null, true);
      return [...cur, keysym];
    });
  };

  const releaseMods = () => {
    const rfb = rfbRef.current;
    if (rfb) for (const m of mods) rfb.sendKey(m, null, false);
    if (mods.length) setMods([]);
  };

  const sendKeysym = (keysym: number, code: string | null = null) => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.sendKey(keysym, code, true);
    rfb.sendKey(keysym, code, false);
    releaseMods();
  };

  const toggleKeyboard = () => {
    if (keyboardActive) kbdRef.current?.blur();
    else kbdRef.current?.focus();
  };

  // Keep the textarea focused when tapping on-screen control buttons, otherwise
  // the tap blurs it: the soft keyboard closes and modifier chains break.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  const onKbdKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const keysym = SPECIAL_KEYSYMS[e.key];
    if (keysym) {
      sendKeysym(keysym, e.code);
      e.preventDefault();
    }
  };

  const onKbdInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const data = (e.nativeEvent as InputEvent).data;
    if (data) {
      for (const ch of data) {
        const cp = ch.codePointAt(0)!;
        sendKeysym(cp < 0x100 ? cp : 0x01000000 + cp);
      }
    }
    if (kbdRef.current) kbdRef.current.value = "";
  };

  return (
    <div className="panel remote-panel">
      <div ref={stageRef} className="vnc-stage">
        <div ref={zoomRef} className="vnc-zoom">
          <div ref={containerRef} className="vnc-container" />
        </div>

        {connected ? (
          <>
            <div className="vnc-overlay">
              <button
                type="button"
                className={keyboardActive ? "active" : ""}
                onMouseDown={keepFocus}
                onClick={toggleKeyboard}
                title="Keyboard"
              >
                ⌨
              </button>
              <button
                type="button"
                className={rotated ? "active" : ""}
                onClick={() => setRotated((r) => !r)}
                title="Rotate to fill vertically"
              >
                ⟳
              </button>
              <button type="button" onClick={() => resetViewRef.current()} title="Reset zoom">
                Fit
              </button>
              <button type="button" onClick={stopVnc} title="Disconnect screen">
                Stop
              </button>
            </div>
            <div className="vnc-keys">
              {MODIFIERS.map((m) => (
                <button
                  key={m.keysym}
                  type="button"
                  className={mods.includes(m.keysym) ? "active" : ""}
                  onMouseDown={keepFocus}
                  onClick={() => toggleMod(m.keysym)}
                >
                  {m.label}
                </button>
              ))}
              <button type="button" onMouseDown={keepFocus} onClick={() => sendKeysym(0xff1b)}>
                Esc
              </button>
              <button type="button" onMouseDown={keepFocus} onClick={() => sendKeysym(0xff09)}>
                Tab
              </button>
            </div>
          </>
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
          onFocus={() => setKeyboardActive(true)}
          onBlur={() => setKeyboardActive(false)}
        />
      </div>
    </div>
  );
}

const MODIFIERS = [
  { label: "Ctrl", keysym: 0xffe3 },
  { label: "Alt", keysym: 0xffe9 },
  { label: "Shift", keysym: 0xffe1 },
];

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
