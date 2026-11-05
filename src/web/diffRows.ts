import type { DiffChange } from "../shared/api";

export type DiffRow =
  /**
   * The start of a hunk (`header`), after `hidden` unchanged lines of gap
   * `gap` that can be expanded. The row after the last change has no header.
   */
  | { type: "hunk"; gap: number; hidden: number; header: string }
  | { type: "context"; old: number; new: number }
  | { type: "delete"; old: number }
  | { type: "insert"; new: number };

/** Lines shown beyond the default context: below the hunk above a gap, above the hunk below it. */
export type Revealed = Record<number, { top: number; bottom: number }>;

const CONTEXT = 3;

/**
 * The rows of a unified diff (docs/design/差分表示.md): each change with 3
 * unchanged lines around it, changes close enough sharing a hunk, and the
 * unchanged lines in between hidden unless revealed.
 */
export function diffRows(
  changes: DiffChange[],
  oldCount: number,
  newCount: number,
  revealed: Revealed = {},
): DiffRow[] {
  if (changes.length === 0) return [];
  const rows: DiffRow[] = [];
  let oldLine = 1; // the first line of the current gap
  let newLine = 1;
  for (let gap = 0; gap <= changes.length; gap++) {
    const next = changes[gap];
    const oldFrom = next
      ? next.oldCount
        ? next.oldStart
        : next.oldStart + 1
      : oldCount + 1;
    const length = oldFrom - oldLine;
    const top = Math.min(
      length,
      (gap > 0 ? CONTEXT : 0) + (revealed[gap]?.top ?? 0),
    );
    const bottom = Math.min(
      length - top,
      (next ? CONTEXT : 0) + (revealed[gap]?.bottom ?? 0),
    );
    const hidden = length - top - bottom;
    for (let i = 0; i < length; i++) {
      if (i === top && (hidden > 0 || gap === 0)) {
        rows.push({ type: "hunk", gap, hidden, header: next?.context ?? "" });
      }
      if (i >= top && i < top + hidden) continue;
      rows.push({ type: "context", old: oldLine + i, new: newLine + i });
    }
    if (length === 0 && gap === 0) {
      rows.push({ type: "hunk", gap, hidden: 0, header: next?.context ?? "" });
    }
    oldLine += length;
    newLine += length;
    if (!next) break;
    for (let i = 0; i < next.oldCount; i++)
      rows.push({ type: "delete", old: oldLine + i });
    for (let i = 0; i < next.newCount; i++)
      rows.push({ type: "insert", new: newLine + i });
    oldLine += next.oldCount;
    newLine += next.newCount;
  }
  return withHeaders(rows);
}

/** Fills in each hunk's `@@ -a,b +c,d @@` from the rows up to the next hunk. */
function withHeaders(rows: DiffRow[]): DiffRow[] {
  let lastOld = 0;
  let lastNew = 0;
  return rows.map((row, i) => {
    if (row.type !== "hunk") {
      if (row.type !== "insert") lastOld = row.old;
      if (row.type !== "delete") lastNew = row.new;
      return row;
    }
    let end = rows.findIndex((r, j) => j > i && r.type === "hunk");
    if (end < 0) end = rows.length;
    const hunk = rows.slice(i + 1, end);
    if (hunk.length === 0) return row; // after the last change
    const olds = hunk.flatMap((r) =>
      r.type === "insert" || r.type === "hunk" ? [] : [r.old],
    );
    const news = hunk.flatMap((r) =>
      r.type === "delete" || r.type === "hunk" ? [] : [r.new],
    );
    const range = (lines: number[], before: number) =>
      `${lines[0] ?? before},${lines.length}`;
    const at = `@@ -${range(olds, lastOld)} +${range(news, lastNew)} @@`;
    return { ...row, header: row.header ? `${at} ${row.header}` : at };
  });
}
