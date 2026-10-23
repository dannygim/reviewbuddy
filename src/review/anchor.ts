import { splitLines } from "../render/highlight";

/** The selected lines (1-based, inclusive) and the file hash, or null if out of range. */
export function anchorFor(
  text: string,
  startLine: number,
  endLine: number,
): { anchorText: string; fileSha: string } | null {
  const lines = splitLines(text);
  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    endLine > lines.length
  )
    return null;
  return {
    anchorText: lines.slice(startLine - 1, endLine).join("\n"),
    fileSha: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
  };
}
