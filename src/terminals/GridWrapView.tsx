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

// Wrapped view with the cursor rendered as an inverse cell at its actual
// (row, col) — a marker at the start of the line hid the real position.
export function GridWrapView({ grid }: { grid: EditorGridEvent }) {
  const lines = gridLines(grid);
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
}
