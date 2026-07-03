import type { CSSProperties, ReactNode } from "react";
import type { EditorGridEvent } from "@protocol/schema";

export function gridLines(grid: EditorGridEvent): string[] {
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
}

function hlStyle(grid: EditorGridEvent, id: number): CSSProperties | undefined {
  const h = grid.highlights?.[id];
  if (!h) return undefined;
  return {
    color: h.fg,
    backgroundColor: h.bg,
    fontWeight: h.bold ? 600 : undefined,
    fontStyle: h.italic ? "italic" : undefined,
  };
}

// Wrapped view of the grid: rows of highlight runs (colored spans) with the
// cursor rendered as an inverse cell at its actual (row, col).
export function GridWrapView({ grid }: { grid: EditorGridEvent }) {
  const cell = (r: number, c: number) => grid.cells[r * grid.width + c];
  const rows: ReactNode[] = [];
  for (let r = 0; r < grid.height; r++) {
    const isCursorRow = r === grid.cursor_row;
    // Trim trailing blanks so wrapping stays tidy; keep the cursor cell.
    let end = grid.width;
    while (end > 0 && (cell(r, end - 1)?.text ?? " ").trim() === "") end--;
    if (isCursorRow) end = Math.max(end, Math.min(grid.cursor_col + 1, grid.width));
    const spans: ReactNode[] = [];
    let c = 0;
    while (c < end) {
      if (isCursorRow && c === grid.cursor_col) {
        spans.push(
          <span key={c} className="wrap-cursor">
            {cell(r, c)?.text || " "}
          </span>,
        );
        c++;
        continue;
      }
      const id = cell(r, c)?.hl_id ?? 0;
      const start = c;
      let text = "";
      while (
        c < end &&
        (cell(r, c)?.hl_id ?? 0) === id &&
        !(isCursorRow && c === grid.cursor_col)
      ) {
        text += cell(r, c)?.text || " ";
        c++;
      }
      const style = hlStyle(grid, id);
      spans.push(
        style ? (
          <span key={start} style={style}>
            {text}
          </span>
        ) : (
          text
        ),
      );
    }
    rows.push(<span key={r}>{spans}</span>, "\n");
  }
  return <pre className="wrap-view">{rows}</pre>;
}
