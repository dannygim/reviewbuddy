type Anchored = { startLine: number; endLine: number; anchorText: string };

export type Anchor = { startLine: number; endLine: number; outdated: boolean };

/**
 * Finds a thread's lines again after its file changed (docs/design/データモデル.md):
 * the original position if it still matches, else the nearest exact copy of
 * the anchor text (the earlier one on a tie), else outdated at the old range.
 * Always compares with the text at creation, so a thread recovers if it comes back.
 */
export function reanchor(thread: Anchored, lines: string[] | null): Anchor {
  const stay = { startLine: thread.startLine, endLine: thread.endLine };
  if (lines === null) return { ...stay, outdated: true };
  const anchor = thread.anchorText.split("\n");
  const matchesAt = (start: number) =>
    anchor.every((line, i) => lines[start - 1 + i] === line);

  if (
    thread.endLine - thread.startLine + 1 === anchor.length &&
    matchesAt(thread.startLine)
  ) {
    return { ...stay, outdated: false };
  }
  let best: number | null = null;
  for (let start = 1; start + anchor.length - 1 <= lines.length; start++) {
    if (
      matchesAt(start) &&
      (best === null ||
        Math.abs(start - thread.startLine) < Math.abs(best - thread.startLine))
    ) {
      best = start;
    }
  }
  return best === null
    ? { ...stay, outdated: true }
    : { startLine: best, endLine: best + anchor.length - 1, outdated: false };
}
