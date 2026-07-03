import { useCallback, useEffect, useRef, useState } from "react";
import type { BridgeClient } from "../bridge/client";
import type { EditorGridEvent, TerminalSnapshot } from "@protocol/schema";
import { loadPrefs } from "../settings/webPrefs";

type ViewMode = "wrap" | "grid";

type Props = { client: BridgeClient };

const HL_COLORS: Record<number, string> = {
  0: "var(--text)",
  1: "#7aa2f7",
  2: "#9ece6a",
  3: "#e0af68",
  4: "#bb9af7",
  5: "#f7768e",
};

export function TerminalsPanel({ client }: Props) {
  const [terminals, setTerminals] = useState<TerminalSnapshot[]>([]);
  const [grid, setGrid] = useState<EditorGridEvent | null>(null);
  // Wrapping on by default (web pref); zi/zo still toggle it like on desktop.
  const [viewMode, setViewMode] = useState<ViewMode>(
    loadPrefs().terminalWrap ? "wrap" : "grid",
  );
  const [pendingKeys, setPendingKeys] = useState("");
  const [kbdFocused, setKbdFocused] = useState(false);
  // Height of the on-screen keyboard (layout viewport minus visual viewport),
  // so the floating status bar can sit right above it.
  const [keyboardInset, setKeyboardInset] = useState(0);
  const pendingRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kbdRef = useRef<HTMLTextAreaElement | null>(null);

  const refreshTerminals = useCallback(() => {
    client
      .call<TerminalSnapshot[]>("terminals.list")
      .then(setTerminals)
      .catch(() => undefined);
  }, [client]);

  useEffect(() => {
    client.call("editor.subscribe").catch(() => undefined);
    refreshTerminals();
    return client.on((event, data) => {
      if (event === "editor.grid") setGrid(data as EditorGridEvent);
    });
  }, [client, refreshTerminals]);

  // Track how much of the window the soft keyboard covers (visualViewport
  // shrinks; fixed elements keep layout-viewport coordinates).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setKeyboardInset(
        Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
      );
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  const viewTerminal = async (id: number) => {
    try {
      await client.call("terminals.view", { id });
      refreshTerminals();
    } catch {
      /* terminal may have just closed; the next refresh will drop it */
    }
  };

  const createTerminal = async () => {
    try {
      await client.call("terminals.create");
      // Spawn is async on the IDE side — refresh now and again shortly after
      // so the chip appears once the instance is up.
      refreshTerminals();
      setTimeout(refreshTerminals, 1200);
    } catch {
      /* IDE busy — user can retry */
    }
  };

  const flushKeys = (keys: string) => {
    if (!keys) return;
    client.call("editor.key", { keys }).catch(() => undefined);
  };

  const pushKey = (ch: string) => {
    const next = pendingRef.current + ch;
    pendingRef.current = next;
    setPendingKeys(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const seq = pendingRef.current;
      pendingRef.current = "";
      setPendingKeys("");
      if (seq === "zi") {
        setViewMode("wrap");
        return;
      }
      if (seq === "zo") {
        setViewMode("grid");
        return;
      }
      flushKeys(seq);
    }, 400);
  };

  // Backspace first eats locally-buffered (not yet flushed) chars; only when
  // the buffer is empty does it go to nvim. Sending <BS> immediately while
  // chars sat in the 400ms batch would arrive out of order.
  const sendBackspace = () => {
    if (pendingRef.current) {
      pendingRef.current = pendingRef.current.slice(0, -1);
      setPendingKeys(pendingRef.current);
      return;
    }
    flushKeys("<BS>");
  };

  const sendEnter = () => {
    flushKeys(pendingRef.current + "\n");
    pendingRef.current = "";
    setPendingKeys("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The hidden textarea sits inside the panel div and both bind this
    // handler — without stopPropagation every key bubbles up and is sent
    // twice (Backspace showed up as ^?^?).
    e.stopPropagation();
    // Android soft keyboards report "Unidentified"/229 here and deliver the
    // real text through input events — let onKbdInput handle those.
    if (e.key === "Unidentified" || e.key === "Process") return;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      pushKey(e.key);
    } else if (e.key === "Enter") {
      e.preventDefault();
      sendEnter();
    } else if (e.key === "Backspace") {
      e.preventDefault();
      sendBackspace();
    } else if (e.key === "Delete") {
      e.preventDefault();
      flushKeys("<Del>");
    } else if (e.key === "Tab") {
      e.preventDefault();
      flushKeys("<Tab>");
    } else if (e.key === "Escape") flushKeys("<Esc>");
    else if (e.key === "ArrowUp") flushKeys("<Up>");
    else if (e.key === "ArrowDown") flushKeys("<Down>");
    else if (e.key === "ArrowLeft") flushKeys("<Left>");
    else if (e.key === "ArrowRight") flushKeys("<Right>");
  };

  // Mobile keyboards deliver text via input events instead of key events, and
  // backspace on an empty field often produces nothing at all. Keep a sentinel
  // char in the textarea: deleting it means Backspace; anything after it is
  // typed text. Control chars (Android's raw DEL byte showed up as ^?) are
  // never forwarded literally.
  const KBD_SENTINEL = " ";
  const resetKbd = (el: HTMLTextAreaElement) => {
    el.value = KBD_SENTINEL;
    el.setSelectionRange(el.value.length, el.value.length);
  };
  const onKbdInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const value = el.value;
    if (value.length < KBD_SENTINEL.length) {
      sendBackspace();
    } else {
      const typed = value.startsWith(KBD_SENTINEL)
        ? value.slice(KBD_SENTINEL.length)
        : value;
      for (const ch of typed) {
        const code = ch.charCodeAt(0);
        if (ch === "\n") sendEnter();
        else if (code === 0x7f || code === 0x08) sendBackspace();
        else if (code >= 0x20) pushKey(ch);
      }
    }
    resetKbd(el);
  };

  const gridLines = () => {
    if (!grid) return [];
    const lines: string[] = [];
    for (let r = 0; r < grid.height; r++) {
      let line = "";
      for (let c = 0; c < grid.width; c++) {
        const cell = grid.cells[r * grid.width + c];
        line += cell?.text ?? " ";
      }
      lines.push(line.replace(/\s+$/, ""));
    }
    return lines;
  };

  // Wrapped view with the cursor rendered as an inverse cell at its actual
  // (row, col) — a marker at the start of the line hid the real position.
  const wrapView = () => {
    if (!grid) return null;
    const lines = gridLines();
    const row = Math.min(grid.cursor_row, lines.length - 1);
    let at = lines[row] ?? "";
    const col = Math.max(0, grid.cursor_col);
    if (at.length <= col) at = at.padEnd(col + 1, " ");
    const before = lines.slice(0, row).join("\n");
    const after = lines.slice(row + 1).join("\n");
    return (
      <pre className="wrap-view">
        {before}
        {row > 0 ? "\n" : ""}
        {at.slice(0, col)}
        <span className="wrap-cursor">{at[col] ?? " "}</span>
        {at.slice(col + 1)}
        {"\n"}
        {after}
      </pre>
    );
  };

  // Bottom rows of the nvim screen (statusline + cmdline/messages) — floated
  // above the soft keyboard so you can see what you're typing in command mode.
  const statusLines = () => {
    if (!grid) return "";
    const lines = gridLines();
    return lines.slice(Math.max(0, lines.length - 2)).join("\n");
  };

  return (
    <div className="panel terminals-panel" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="terminal-chips">
        {terminals.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`terminal-chip${t.viewed ? " active" : ""}`}
            onClick={() => viewTerminal(t.id)}
          >
            <span className={`terminal-dot${t.running ? " running" : ""}`} />
            {t.name}
            <span className="terminal-kind">{t.kind}</span>
          </button>
        ))}
        {terminals.length === 0 && (
          <p className="hint">No terminals open in the IDE.</p>
        )}
        <button
          type="button"
          className="ghost terminal-refresh"
          onClick={createTerminal}
          title="New terminal"
        >
          +
        </button>
        <button type="button" className="ghost terminal-refresh" onClick={refreshTerminals}>
          ↻
        </button>
      </div>

      <div className="terminal-toolbar">
        <span className="mode">{grid?.mode_text ?? "—"}</span>
        <span className="hint keys-hint">
          {pendingKeys ? `keys: ${pendingKeys}` : "zi wrap · zo grid"}
        </span>
        {/* onMouseDown preventDefault keeps focus (and the soft keyboard) on
            the key sink while tapping these. */}
        <button
          type="button"
          className="chip"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => flushKeys("<Esc>")}
          title="Back to normal mode"
        >
          Esc
        </button>
        <button
          type="button"
          className={`chip${viewMode === "wrap" ? " active" : ""}`}
          onClick={() => setViewMode(viewMode === "wrap" ? "grid" : "wrap")}
        >
          Wrap
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => kbdRef.current?.focus()}
        >
          ⌨ Keys
        </button>
      </div>

      {!grid ? (
        <p className="hint">Waiting for terminal sync…</p>
      ) : viewMode === "wrap" ? (
        wrapView()
      ) : (
        <div className="grid-scroll">
          <div
            className="grid-view"
            style={{
              gridTemplateColumns: `repeat(${grid.width}, 1ch)`,
              gridTemplateRows: `repeat(${grid.height}, 1.2em)`,
            }}
          >
            {grid.cells.map((cell, i) => (
              <span
                key={i}
                className={
                  Math.floor(i / grid.width) === grid.cursor_row &&
                  i % grid.width === grid.cursor_col
                    ? "cell cursor"
                    : "cell"
                }
                style={{ color: HL_COLORS[cell.hl_id % 6] ?? HL_COLORS[0] }}
              >
                {cell.text || " "}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Floating nvim status/command line pinned above the soft keyboard so
          command-mode typing is visible while the keyboard covers the view. */}
      {kbdFocused && grid && (
        <div className="kbd-statusbar" style={{ bottom: keyboardInset }}>
          <div className="kbd-statusbar-mode">
            <span>{grid.mode_text || "…"}</span>
            {pendingKeys && <span className="kbd-pending">{pendingKeys}</span>}
            <button
              type="button"
              className="chip"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => flushKeys("<Esc>")}
            >
              Esc
            </button>
          </div>
          <pre className="kbd-statusbar-lines">{statusLines()}</pre>
        </div>
      )}

      {/* Off-screen sink that opens the soft keyboard and forwards keystrokes. */}
      <textarea
        ref={kbdRef}
        className="term-kbd"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={onKeyDown}
        onInput={onKbdInput}
        onFocus={(e) => {
          resetKbd(e.currentTarget);
          setKbdFocused(true);
        }}
        onBlur={() => setKbdFocused(false)}
      />
    </div>
  );
}
