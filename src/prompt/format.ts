import type { Thread } from "../shared/api";
import { compareTreePaths } from "../shared/tree";

export type PromptOptions = {
  /** Text placed before the threads; empty for none. */
  preamble: string;
  /** Longer selections keep their head and tail around an omission line. */
  maxAnchorLines: number;
};

export const DEFAULT_PROMPT_OPTIONS: PromptOptions = {
  preamble: "",
  maxAnchorLines: 30,
};

/** Tree order of the file, then the first line, then creation time. */
export function sortThreads(threads: Thread[]): Thread[] {
  return [...threads].sort(
    (a, b) =>
      compareTreePaths(a.path, b.path) ||
      a.startLine - b.startLine ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

const indent = (line: string) => (line === "" ? "" : `  ${line}`);

function anchorLines(text: string, max: number): string[] {
  const lines = text.split("\n");
  if (lines.length <= max) return lines;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return [
    ...lines.slice(0, head),
    `… (${lines.length - head - tail} lines omitted)`,
    ...lines.slice(lines.length - tail),
  ];
}

/** The Coding Agent prompt described in docs/design/プロンプト出力仕様.md. */
export function formatPrompt(
  threads: Thread[],
  options: PromptOptions,
): string {
  const blocks = sortThreads(threads).map((thread, i) => {
    const range =
      thread.startLine === thread.endLine
        ? `${thread.startLine}`
        : `${thread.startLine}-${thread.endLine}`;
    const heading = `${i + 1}. ${thread.path}:${range}${thread.outdated ? " (outdated)" : ""}`;
    const anchor = anchorLines(thread.anchorText, options.maxAnchorLines);
    const comments = thread.comments.flatMap((comment) => {
      const lines = comment.body.split("\n");
      lines[lines.length - 1] += ` by ${comment.author}`;
      return lines;
    });
    return [heading, ...anchor, "", ...comments].map((line, j) =>
      j === 0 ? line : indent(line),
    );
  });
  if (blocks.length === 0) return "";
  const body = blocks.map((lines) => lines.join("\n")).join("\n\n");
  return `${options.preamble ? `${options.preamble}\n\n` : ""}${body}\n`;
}

/** One JSON object per thread, for `reviewbuddy export --format jsonl`. */
export function formatJsonl(threads: Thread[]): string {
  return sortThreads(threads)
    .map((t) =>
      JSON.stringify({
        id: t.id,
        path: t.path,
        startLine: t.startLine,
        endLine: t.endLine,
        status: t.status,
        outdated: t.outdated,
        anchorText: t.anchorText,
        originView: t.originView,
        createdBy: t.createdBy,
        createdAt: t.createdAt,
        resolvedBy: t.resolvedBy,
        resolvedAt: t.resolvedAt,
        exportedAt: t.exportedAt,
        comments: t.comments.map((c) => ({
          id: c.id,
          author: c.author,
          body: c.body,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
      }),
    )
    .map((line) => `${line}\n`)
    .join("");
}
