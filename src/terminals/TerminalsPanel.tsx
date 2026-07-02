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

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The hidden textarea sits inside the panel div and both bind this
    // handler — without stopPropagation every key bubbles up and is sent
    // twice (Backspace showed up as ^?^?).
    e.stopPropagation();
    if (e.key.length === 1) {
      e.preventDefault();
      pushKey(e.key);
    } else if (e.key === "Enter") {
      e.preventDefault();
      flushKeys(pendingRef.current + "\n");
      pendingRef.current = "";
      setPendingKeys("");
    } else if (e.key === "Backspace") {
      e.preventDefault();
      flushKeys("<BS>");
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

  // Mobile keyboards often deliver text via input events instead of key events.
  const onKbdInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const value = e.currentTarget.value;
    if (value) {
      for (const ch of value) pushKey(ch);
      e.currentTarget.value = "";
    }
  };

  const wrapText = () => {
    if (!grid) return "";
    const lines: string[] = [];
    for (let r = 0; r < grid.height; r++) {
      let line = "";
      for (let c = 0; c < grid.width; c++) {
        const cell = grid.cells[r * grid.width + c];
        line += cell?.text ?? " ";
      }
      lines.push(line.replace(/\s+$/, ""));
    }
    const cursorLine = grid.cursor_row;
    const before = lines.slice(0, cursorLine).join("\n");
    const at = lines[cursorLine] ?? "";
    const after = lines.slice(cursorLine + 1).join("\n");
    return `${before}\n▌${at}\n${after}`;
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
        <pre className="wrap-view">{wrapText()}</pre>
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

      {/* Off-screen sink that opens the soft keyboard and forwards keystrokes. */}
      <textarea
        ref={kbdRef}
        className="term-kbd"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={onKeyDown}
        onInput={onKbdInput}
      />
    </div>
  );
}
