import { isImagePath } from "../render/file-view";
import { highlightLines, splitLines } from "../render/highlight";
import { detectLanguage } from "../render/language";
import type { ChangedFile, DiffChange, FileDiff } from "../shared/api";
import { BaseError, type Branch, baseCommit } from "./branches";
import { gitOutput, gitText, isBinary } from "./git";
import { renderMarkdownDiff } from "./markdown-diff";
import { diffSequences } from "./myers";
import { type Range, wordRanges } from "./words";

export type DiffOptions = {
  maxHighlightBytes: number;
  /** Whether a root-relative path is listed; used to rewrite Markdown links. */
  isListed: (path: string) => boolean;
  /** Compare with where HEAD left this branch instead of with HEAD. */
  base?: Branch | null;
};

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/gm;
/** Above this many changed lines, lineChanges replaces a stretch as a whole. */
const MAX_LINE_COST = 1000;

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
 * The line changes from old to new, found here instead of by Git (so without
 * function names), in the same form as the hunks of a `-U0` patch.
 */
export function lineChanges(
  oldLines: string[],
  newLines: string[],
): DiffChange[] {
  const changes: DiffChange[] = [];
  const edits = diffSequences(oldLines, newLines, MAX_LINE_COST);
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    if (edit.type === "equal") continue;
    const oldCount = edit.type === "delete" ? edit.count : 0;
    const next = edits[i + 1];
    let newCount = edit.type === "insert" ? edit.count : 0;
    if (edit.type === "delete" && next?.type === "insert") {
      newCount = next.count;
      i++;
    }
    // Like Git, an empty side starts at the line before the change.
    changes.push({
      oldStart: oldCount ? edit.a + 1 : edit.a,
      oldCount,
      newStart: newCount ? edit.b + 1 : edit.b,
      newCount,
      context: "",
    });
  }
  return changes;
}

/**
 * The diff of one changed file (docs/design/差分表示.md). `newBytes` is the
 * work-tree side (from readWorkTree), or null for a deleted file.
 */
export async function renderDiff(
  root: string,
  change: ChangedFile,
  newBytes: Uint8Array | null,
  options: DiffOptions,
): Promise<FileDiff> {
  const { path } = change;
  const oldPath = change.oldPath ?? path;
  if (isImagePath(path)) return { kind: "binary", path };
  // One commit for both the old side and Git's hunks, even if HEAD moves.
  const commit = await baseCommit(root, options.base?.ref ?? null);
  if (options.base && commit === null) throw new BaseError(options.base.name);
  const oldBytes =
    change.status === "added" || commit === null
      ? new Uint8Array()
      : ((await gitOutput(root, [
          "cat-file",
          "blob",
          `${commit}:./${oldPath}`,
        ])) ?? new Uint8Array());
  newBytes ??= new Uint8Array();
  if (isBinary(oldBytes) || isBinary(newBytes)) return { kind: "binary", path };

  const oldText = new TextDecoder().decode(oldBytes);
  const newText = new TextDecoder().decode(newBytes);
  const oldLines = oldText === "" ? [] : splitLines(oldText);
  const newLines = newText === "" ? [] : splitLines(newText);
  const changes = await diffChanges(root, commit, change, oldLines, newLines);

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
  commit: string | null,
  change: ChangedFile,
  oldLines: string[],
  newLines: string[],
): Promise<DiffChange[]> {
  if (change.status === "added" || change.status === "deleted" || !commit) {
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
    commit,
    "-M",
    "--relative",
    "-p",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--",
    ...paths.map((p) => `:(literal)${p}`),
  ]);
  const changes = parseHunkHeaders(patch ?? "");
  // Git read the work tree again, and compares what its index has: if the
  // file changed meanwhile or the index does not have it (`git rm --cached`),
  // its hunks describe other lines.
  return describes(patch ?? "", changes, oldLines, newLines)
    ? changes
    : lineChanges(oldLines, newLines);
}

/** Whether a `-U0` patch removes and adds exactly these lines. */
function describes(
  patch: string,
  changes: DiffChange[],
  oldLines: string[],
  newLines: string[],
): boolean {
  const removed: string[] = [];
  const added: string[] = [];
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff ")) inHunk = false;
    else if (line.startsWith("@@ ")) inHunk = true;
    else if (inHunk && line.startsWith("-")) removed.push(line.slice(1));
    else if (inHunk && line.startsWith("+")) added.push(line.slice(1));
  }
  const expected = (lines: string[], start: number, count: number) =>
    count ? lines.slice(start - 1, start - 1 + count) : [];
  const same = (a: string[], b: string[]) =>
    a.length === b.length &&
    a.every((line, i) => line.replace(/\r$/, "") === b[i]);
  const delta = changes.reduce((n, c) => n + c.newCount - c.oldCount, 0);
  return (
    oldLines.length + delta === newLines.length &&
    same(
      removed,
      changes.flatMap((c) => expected(oldLines, c.oldStart, c.oldCount)),
    ) &&
    same(
      added,
      changes.flatMap((c) => expected(newLines, c.newStart, c.newCount)),
    )
  );
}
