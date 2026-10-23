export type Health = {
  name: "akapen";
  version: string;
  root: string;
  sessionId: string;
};

export type SessionInfo = {
  id: string;
  root: string;
  /** The root with the home directory shown as ~. */
  rootDisplay: string;
  status: "active" | "ended";
  readOnly: boolean;
  /** Send as X-Akapen-Token on writes. */
  token: string;
  /** Default of "Resolve copied threads" (config prompt.resolve_on_copy). */
  resolveOnCopy: boolean;
  /** Prompt settings, for formatting in the browser when read-only. */
  prompt: { preamble: string; maxAnchorLines: number };
};

export type TreeResponse = { files: string[] };

export type ErrorResponse = { error: string };

type TextFields = {
  path: string;
  mtime: number;
  lang: string;
  /** Source lines, without line terminators. */
  lines: string[];
  /** One HTML string per line (highlighted, or escaped for "large"). */
  lineHtml: string[];
};

export type FileView =
  | ({ kind: "code" | "large" } & TextFields)
  | ({
      kind: "markdown";
      /** Rendered Markdown; block elements carry data-src-start / data-src-end. */
      previewHtml: string;
    } & TextFields)
  | { kind: "image" | "binary"; path: string; mtime: number };

export type PromptResponse = {
  text: string;
  /** The threads after recording the export (and resolving, if asked). */
  threads: Thread[];
};

export type Comment = {
  id: string;
  threadId: string;
  /** Nickname (self-declared). */
  author: string;
  /** Random per-browser ID; edits and deletes are limited to the same ID. */
  clientId: string;
  body: string;
  createdAt: string;
  updatedAt: string | null;
};

export type Thread = {
  id: string;
  path: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  /** The selected source lines when the thread was created. */
  anchorText: string;
  originView: "source" | "preview";
  status: "open" | "resolved";
  outdated: boolean;
  createdBy: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  exportedAt: string | null;
  /** The first comment starts the thread; the rest are replies. */
  comments: Comment[];
};
