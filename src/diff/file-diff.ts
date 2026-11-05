import { readFileSync } from "node:fs";
import { isImagePath } from "../render/file-view";
import { highlightLines, splitLines } from "../render/highlight";
import { detectLanguage } from "../render/language";
import type { ChangedFile, DiffChange, FileDiff } from "../shared/api";
import { gitOutput, gitText, isBinary } from "./git";
import { renderMarkdownDiff } from "./markdown-diff";
import { type Range, wordRanges } from "./words";

export type DiffOptions = {
  maxHighlightBytes: number;
  /** Whether a root-relative path is listed; used to rewrite Markdown links. */
  isListed: (path: string) => boolean;
};

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/gm;

/** The changes in a `-U0` patch, from its hunk headers. */
export function parseHunkHeaders(patch: string): DiffChange[] {
  return [...patch.matchAll(HUNK)].map((m) => ({
    oldStart: Number(m[1]),
    oldCount: m[2] === undefined ? 1 : Number(m[2]),
    newStart: Number(m[3]),
    newCount: m[4] === undefined ? 1 : Number(m[4]),
    context: m[5]!,
  }));
}

/**
 * The diff of one changed file (docs/design/差分表示.md). `newPath` is the
 * file's real path in the work tree, or null for a deleted file.
 */
export async function renderDiff(
  root: string,
  change: ChangedFile,
  newPath: string | null,
  options: DiffOptions,
): Promise<FileDiff> {
  const { path } = change;
  const oldPath = change.oldPath ?? path;
  if (isImagePath(path)) return { kind: "binary", path };
  const oldBytes =
    change.status === "added"
      ? new Uint8Array()
      : ((await gitOutput(root, ["cat-file", "blob", `HEAD:./${oldPath}`])) ??
        new Uint8Array());
  const newBytes = newPath ? readFileSync(newPath) : new Uint8Array();
  if (isBinary(oldBytes) || isBinary(newBytes)) return { kind: "binary", path };

  const oldText = new TextDecoder().decode(oldBytes);
  const newText = new TextDecoder().decode(newBytes);
  const oldLines = oldText === "" ? [] : splitLines(oldText);
  const newLines = newText === "" ? [] : splitLines(newText);
  const changes = await diffChanges(root, change, oldLines, newLines);

  // Pair the i-th deleted line of each change with its i-th added line.
  const oldMarks: Range[][] = [];
  const newMarks: Range[][] = [];
  for (const c of changes) {
    for (let i = 0; i < Math.min(c.oldCount, c.newCount); i++) {
      const o = c.oldStart - 1 + i;
      const n = c.newStart - 1 + i;
      const ranges = wordRanges(oldLines[o]!, newLines[n]!);
      if (!ranges) continue;
      oldMarks[o] = ranges.old;
      newMarks[n] = ranges.new;
    }
  }

  const large =
    Math.max(oldBytes.length, newBytes.length) > options.maxHighlightBytes;
  const lang = (p: string) => (large ? "text" : detectLanguage(p));
  return {
    kind: "text",
    path,
    oldLines: await highlightLines(oldLines, lang(oldPath), oldMarks),
    newLines: await highlightLines(newLines, lang(path), newMarks),
    changes,
    richHtml:
      lang(path) === "markdown"
        ? await renderMarkdownDiff(oldText, newText, {
            path,
            isListed: options.isListed,
          })
        : null,
  };
}

async function diffChanges(
  root: string,
  change: ChangedFile,
  oldLines: string[],
  newLines: string[],
): Promise<DiffChange[]> {
  if (change.status === "added" || change.status === "deleted") {
    if (oldLines.length === 0 && newLines.length === 0) return [];
    return [
      {
        oldStart: oldLines.length ? 1 : 0,
        oldCount: oldLines.length,
        newStart: newLines.length ? 1 : 0,
        newCount: newLines.length,
        context: "",
      },
    ];
  }
  const paths = change.oldPath ? [change.oldPath, change.path] : [change.path];
  const patch = await gitText(root, [
    "diff-index",
    "HEAD",
    "-M",
    "--relative",
    "-p",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--",
    ...paths,
  ]);
  return parseHunkHeaders(patch ?? "");
}
