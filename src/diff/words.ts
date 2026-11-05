import { diffSequences } from "./myers";

/** A [start, end) range of UTF-16 code units in a line. */
export type Range = [number, number];

/**
 * Word tokens: runs of letters, digits and "_" (but each Chinese or Japanese
 * character on its own, as those scripts do not separate words with spaces),
 * runs of whitespace, and any other single character.
 */
export const WORD_TOKEN =
  /(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\p{L}\p{N}_])+|\s+|./gsu;

/** Above this many changed tokens, two lines are not worth comparing. */
const MAX_COST = 500;

/**
 * The ranges that differ between a deleted line and the added line paired
 * with it, or null when the lines share no word (marking everything would
 * only add noise).
 */
export function wordRanges(
  oldLine: string,
  newLine: string,
): { old: Range[]; new: Range[] } | null {
  const a = oldLine.match(WORD_TOKEN) ?? [];
  const b = newLine.match(WORD_TOKEN) ?? [];
  const edits = diffSequences(a, b, MAX_COST);
  const shared = edits.some(
    (e) =>
      e.type === "equal" &&
      a.slice(e.a, e.a + e.count).some((token) => token.trim() !== ""),
  );
  if (!shared) return null;
  return {
    old: ranges(a, edits.filter((e) => e.type === "delete").map(span("a"))),
    new: ranges(b, edits.filter((e) => e.type === "insert").map(span("b"))),
  };
}

const span =
  (side: "a" | "b") =>
  (e: { a: number; b: number; count: number }): Range => [
    e[side],
    e[side] + e.count,
  ];

/** Converts token ranges to character ranges. */
function ranges(tokens: string[], spans: Range[]): Range[] {
  const starts = [0];
  for (const token of tokens) starts.push(starts.at(-1)! + token.length);
  return spans.map(([from, to]) => [starts[from]!, starts[to]!]);
}
