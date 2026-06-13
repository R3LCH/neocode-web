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

  // Pinch-to-zoom + two-finger pan. Implemented with a CSS transform on a
  // wrapper around noVNC's canvas: scale/translate are transform-origin-0,0 and
  // getBoundingClientRect stays transform-aware, so single-finger taps still map
  // to the right remote pixel. Two-finger gestures are captured here (passive:
  // false) so noVNC's own touch handling doesn't fight them.
  useEffect(() => {
    const stage = stageRef.current;
    const zoom = zoomRef.current;
    const container = containerRef.current;
    if (!stage || !zoom || !container) return;

    let scale = 1;
    let tx = 0;
    let ty = 0;
    let startDist = 0;
    let startScale = 1;
    let startMidX = 0;
    let startMidY = 0;
    let startTx = 0;
    let startTy = 0;
    let rectL = 0;
    let rectT = 0;
    let active = false;
    let rotated = false;

    const apply = () => {
      zoom.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    // Rotate the noVNC element 90° clockwise (desktop's left edge → top of the
    // panel, right edge → bottom) and scale the desktop up to fill the panel.
    // We give the element a landscape-shaped size (stage height × stage width)
    // and force noVNC to re-fit the framebuffer into it (its ResizeObserver is
    // rate-limited and otherwise keeps the old, small landscape scale — looking
    // like a bare 90° flip). Then rotate it to occupy the portrait stage.
    // Clicks are disabled here because rotation breaks the tap→pixel mapping.
    const refit = () => {
      const rfb = rfbRef.current;
      if (rfb) rfb.scaleViewport = true;
    };
    const applyRotation = () => {
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      zoom.style.right = "auto";
      zoom.style.bottom = "auto";
      zoom.style.width = `${sh}px`;
      zoom.style.height = `${sw}px`;
      zoom.style.transform = `translate(${sw}px, 0) rotate(90deg)`;
      // Reading a layout property flushes the resize so noVNC re-fits to it.
      void zoom.offsetWidth;
      refit();
    };

    setRotatedRef.current = (on: boolean) => {
      rotated = on;
      if (on) {
        container.style.pointerEvents = "none";
        applyRotation();
        // The viewport can settle a beat later (e.g. keyboard), so recompute.
        setTimeout(applyRotation, 350);
      } else {
        container.style.pointerEvents = "";
        zoom.style.right = "";
        zoom.style.bottom = "";
        zoom.style.width = "";
        zoom.style.height = "";
        scale = 1;
        tx = 0;
        ty = 0;
        apply();
        void zoom.offsetWidth;
        refit();
      }
    };

    const onResize = () => {
      if (rotated) applyRotation();
    };
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    const onStart = (e: TouchEvent) => {
      if (rotated || e.touches.length !== 2) return;
      const rect = stage.getBoundingClientRect();
      rectL = rect.left;
      rectT = rect.top;
      active = true;
      startDist = dist(e.touches);
      startScale = scale;
      startMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rectL;
      startMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rectT;
      startTx = tx;
      startTy = ty;
      e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
      if (rotated || !active || e.touches.length !== 2) return;
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rectL;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rectT;
      const ns = Math.min(5, Math.max(1, (startScale * dist(e.touches)) / startDist));
      // Anchor the zoom on the pinch midpoint and pan as it moves.
      const cx = (startMidX - startTx) / startScale;
      const cy = (startMidY - startTy) / startScale;
      scale = ns;
      tx = mx - ns * cx;
      ty = my - ns * cy;
      apply();
      e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) active = false;
    };

    resetViewRef.current = () => {
      scale = 1;
      tx = 0;
      ty = 0;
      apply();
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
