import { useEffect, useRef, useState } from "react";
import type { BridgeClient } from "../bridge/client";
// @ts-expect-error noVNC ships without TS types
import RFB from "@novnc/novnc";

type Props = { client: BridgeClient };

export function RemotePanel({ client }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
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

  // We own the view transform (CSS scale/translate/rotate on the zoom wrapper)
  // and feed noVNC framebuffer coordinates ourselves, instead of letting noVNC
  // map raw touches. noVNC's tap→pixel formula is `fb = (clientX − rect.left) /
  // _display.scale` — it can't express our zoom or 90° rotation, which is why a
  // CSS-scaled view mis-clicked and a rotated view couldn't click at all. So
  // the noVNC canvas is pointer-events:none, and we map every gesture ourselves:
  //   • one finger  → left mouse (tap = click, hold = right-click, drag = drag)
  //   • two fingers → pinch-zoom + pan, or two-finger swipe = wheel scroll
  // We also draw our own cursor ring at the mapped point (the OS cursor isn't
  // visible under a finger). Clicks stay accurate at any zoom and rotation.
  useEffect(() => {
    const stage = stageRef.current;
    const zoom = zoomRef.current;
    const container = containerRef.current;
    const cursorEl = cursorRef.current;
    if (!stage || !zoom || !container) return;

    const LEFT = 1;
    const RIGHT = 4;
    const WHEEL_UP = 8;
    const WHEEL_DOWN = 16;
    const DRAG_PX = 10;
    const SCROLL_PX = 28; // two-finger travel per wheel notch
    const HOLD_MS = 500;

    let s = 1; // view scale (non-rotated)
    let tx = 0;
    let ty = 0;
    let rotated = false;
    let k = 1; // rotation fill scale
    let curFb: { x: number; y: number } | null = null; // last mapped pixel

    const metrics = () => {
      const cv = container.querySelector("canvas");
      if (!cv || !cv.clientWidth || !cv.clientHeight) return null;
      return { dispW: cv.clientWidth, dispH: cv.clientHeight };
    };

    // Draw our cursor ring at the screen position of the last mapped pixel,
    // applying the same forward transform so it tracks pans/zooms/rotation.
    const placeCursor = () => {
      if (!cursorEl) return;
      const m = metrics();
      if (!m || !curFb) {
        cursorEl.style.opacity = "0";
        return;
      }
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      const lx = curFb.x + (sw - m.dispW) / 2;
      const ly = curFb.y + (sh - m.dispH) / 2;
      let px: number;
      let py: number;
      if (rotated) {
        const cx = sw / 2;
        const cy = sh / 2;
        px = cx - k * (ly - cy);
        py = cy + k * (lx - cx);
      } else {
        px = tx + s * lx;
        py = ty + s * ly;
      }
      cursorEl.style.left = `${px}px`;
      cursorEl.style.top = `${py}px`;
      cursorEl.style.opacity = "1";
    };

    const applyTransform = () => {
      if (rotated) {
        zoom.style.transformOrigin = "center center";
        zoom.style.transform = `rotate(90deg) scale(${k})`;
      } else {
        zoom.style.transformOrigin = "0 0";
        zoom.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      }
      if (curFb === null) {
        const m = metrics();
        if (m) curFb = { x: m.dispW / 2, y: m.dispH / 2 };
      }
      placeCursor();
    };

    // Screen point → noVNC element-space coords (framebuffer × fit-scale).
    // Invert our CSS transform, then offset by the letterboxed canvas position.
    const toElement = (clientX: number, clientY: number) => {
      const m = metrics();
      if (!m) return null;
      const rect = stage.getBoundingClientRect();
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      let lx: number;
      let ly: number;
      if (rotated) {
        const cx = sw / 2;
        const cy = sh / 2;
        lx = cx + (py - cy) / k;
        ly = cy - (px - cx) / k;
      } else {
        lx = (px - tx) / s;
        ly = (py - ty) / s;
      }
      const x = lx - (sw - m.dispW) / 2;
      const y = ly - (sh - m.dispH) / 2;
      return {
        x: Math.max(0, Math.min(m.dispW - 1, x)),
        y: Math.max(0, Math.min(m.dispH - 1, y)),
      };
    };

    const sendMouse = (clientX: number, clientY: number, mask: number) => {
      const rfb = rfbRef.current;
      const pos = toElement(clientX, clientY);
      if (rfb && pos) {
        rfb._sendMouse(pos.x, pos.y, mask);
        curFb = pos;
        placeCursor();
      }
    };
    // One up/down pulse of a wheel button = one scroll notch.
    const wheel = (clientX: number, clientY: number, mask: number) => {
      sendMouse(clientX, clientY, mask);
      sendMouse(clientX, clientY, 0);
    };

    const applyRotation = () => {
      const m = metrics();
      if (m) k = stage.clientHeight / m.dispW; // displayed width spans the height
      applyTransform();
    };

    setRotatedRef.current = (on: boolean) => {
      rotated = on;
      s = 1;
      tx = 0;
      ty = 0;
      if (on) {
        applyRotation();
        // The viewport can settle a beat later (e.g. keyboard), so recompute.
        setTimeout(applyRotation, 350);
      } else {
        applyTransform();
      }
    };

    resetViewRef.current = () => {
      s = 1;
      tx = 0;
      ty = 0;
      applyTransform();
    };

    const onResize = () => {
      if (rotated) applyRotation();
      else placeCursor();
    };
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    // ---- pointer handling ----
    const pts = new Map<number, { x: number; y: number }>();
    let multi = false; // two fingers have touched this gesture
    // one-finger state machine
    let start = { x: 0, y: 0 };
    let last = { x: 0, y: 0 };
    let engaged = false; // promoted to a left-drag
    let rightDone = false; // long-press already fired a right-click
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let lastMove = 0;
    // two-finger gesture state
    let gDist = 0;
    let gScale = 1;
    let gTx = 0;
    let gTy = 0;
    let gMidX = 0;
    let gMidY = 0;
    let prevMy = 0;
    let scrollAcc = 0;

    const two = () => [...pts.values()];
    const spanOf = (a: { x: number; y: number }[]) =>
      Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    const clearHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.target !== stage) return; // ignore taps on overlay buttons
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1 && !multi) {
        start = { x: e.clientX, y: e.clientY };
        last = start;
        engaged = false;
        rightDone = false;
        sendMouse(e.clientX, e.clientY, 0); // position cursor (no button yet)
        clearHold();
        holdTimer = setTimeout(() => {
          if (!engaged && !multi && pts.size === 1) {
            wheel(start.x, start.y, RIGHT); // long-press = right click
            rightDone = true;
          }
        }, HOLD_MS);
      } else if (pts.size === 2) {
        multi = true;
        clearHold();
        if (engaged) sendMouse(last.x, last.y, 0); // release a started drag
        engaged = false;
        const a = two();
        const rect = stage.getBoundingClientRect();
        gDist = spanOf(a);
        gScale = s;
        gTx = tx;
        gTy = ty;
        gMidX = (a[0].x + a[1].x) / 2 - rect.left;
        gMidY = (a[0].y + a[1].y) / 2 - rect.top;
        prevMy = gMidY;
        scrollAcc = 0;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pts.size === 1 && !multi) {
        last = { x: e.clientX, y: e.clientY };
        if (rightDone) return;
        if (!engaged) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_PX) {
            engaged = true;
            clearHold();
            sendMouse(start.x, start.y, LEFT); // press at the origin…
            sendMouse(e.clientX, e.clientY, LEFT); // …then drag
          } else {
            sendMouse(e.clientX, e.clientY, 0); // keep cursor synced
          }
        } else {
          const now = Date.now();
          if (now - lastMove < 20) return;
          lastMove = now;
          sendMouse(e.clientX, e.clientY, LEFT);
        }
        return;
      }

      if (pts.size === 2) {
        const a = two();
        const rect = stage.getBoundingClientRect();
        const midClientX = (a[0].x + a[1].x) / 2;
        const midClientY = (a[0].y + a[1].y) / 2;
        const mx = midClientX - rect.left;
        const my = midClientY - rect.top;
        const ns = Math.min(8, Math.max(1, (gScale * spanOf(a)) / gDist));
        if (!rotated && (ns > 1.001 || s > 1)) {
          // pinch-zoom + pan
          if (ns <= 1.001) {
            s = 1;
            tx = 0;
            ty = 0;
          } else {
            const cx = (gMidX - gTx) / gScale;
            const cy = (gMidY - gTy) / gScale;
            s = ns;
            tx = mx - ns * cx;
            ty = my - ns * cy;
          }
          applyTransform();
        } else {
          // two-finger swipe = wheel scroll (at fit, or while rotated)
          scrollAcc += my - prevMy;
          while (scrollAcc >= SCROLL_PX) {
            wheel(midClientX, midClientY, WHEEL_UP);
            scrollAcc -= SCROLL_PX;
          }
          while (scrollAcc <= -SCROLL_PX) {
            wheel(midClientX, midClientY, WHEEL_DOWN);
            scrollAcc += SCROLL_PX;
          }
        }
        prevMy = my;
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId)!;
      pts.delete(e.pointerId);
      if (pts.size > 0) return;
      clearHold();
      if (!multi) {
        if (rightDone) {
          // already handled
        } else if (engaged) {
          sendMouse(p.x, p.y, 0); // end left drag
        } else {
          wheel(start.x, start.y, LEFT); // tap = left click
        }
      }
      multi = false;
      engaged = false;
      rightDone = false;
    };

    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    return () => {
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [connected]);

  // Rotation is a manual toggle (the ⟳ button); both orientations are fully
  // interactive now that we map taps ourselves.
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
        {connected && <div ref={cursorRef} className="vnc-cursor" />}

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
