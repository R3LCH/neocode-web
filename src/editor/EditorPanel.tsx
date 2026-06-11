import { useEffect, useRef, useState } from "react";
import type { BridgeClient } from "../bridge/client";
import type { EditorGridEvent } from "@protocol/schema";

type ViewMode = "grid" | "zoom";

type Props = { client: BridgeClient };

const HL_COLORS: Record<number, string> = {
  0: "#e8e8ec",
  1: "#7aa2f7",
  2: "#9ece6a",
  3: "#e0af68",
  4: "#bb9af7",
  5: "#f7768e",
};

export function EditorPanel({ client }: Props) {
  const [grid, setGrid] = useState<EditorGridEvent | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [pendingKeys, setPendingKeys] = useState("");
  const pendingRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    client.call("editor.subscribe").catch(() => undefined);
    return client.on((event, data) => {
      if (event === "editor.grid") setGrid(data as EditorGridEvent);
    });
  }, [client]);

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
        setViewMode("zoom");
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
    if (e.key === "Escape") {
      setViewMode("grid");
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      pushKey(e.key);
    } else if (e.key === "Enter") {
      flushKeys(pendingRef.current + "\n");
      pendingRef.current = "";
      setPendingKeys("");
    } else if (e.key === "Backspace") {
      flushKeys("<BS>");
    } else if (e.key === "ArrowUp") flushKeys("<Up>");
    else if (e.key === "ArrowDown") flushKeys("<Down>");
    else if (e.key === "ArrowLeft") flushKeys("<Left>");
    else if (e.key === "ArrowRight") flushKeys("<Right>");
  };

  const zoomText = () => {
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

  if (!grid) {
    return <div className="panel">Waiting for editor sync…</div>;
  }

  return (
    <div className="panel editor-panel" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="row">
        <span className="mode">{grid.mode_text}</span>
        <span className="hint">Keys: {pendingKeys || "—"} | zi=zoom zo=normal</span>
        <span className="view-badge">{viewMode}</span>
      </div>
      {viewMode === "zoom" ? (
        <pre className="zoom-view">{zoomText()}</pre>
      ) : (
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
      )}
    </div>
  );
}
