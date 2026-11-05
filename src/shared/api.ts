export type Health = {
  name: "reviewbuddy";
  version: string;
  sessionId: string;
};

export type SessionInfo = {
  id: string;
  root: string;
  /** The root with the home directory shown as ~. */
  rootDisplay: string;
  status: "active" | "ended";
  readOnly: boolean;
  /** Send as X-Reviewbuddy-Token on writes. */
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

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

/** A file with uncommitted changes (HEAD against the work tree). */
export type ChangedFile = {
  /** The path in the work tree; for a deleted file, the path it had. */
  path: string;
  /** The path in HEAD of a renamed file, else null. */
  oldPath: string | null;
  status: ChangeStatus;
  /** Added and deleted lines; null for binary files. */
  additions: number | null;
  deletions: number | null;
  /** Changes whenever the change does; a Viewed mark holds only while it matches. */
  version: string;
};

export type ChangesResponse = {
  /** False when the root is not in a Git work tree (no Changes view). */
  git: boolean;
  /** In tree order. */
  files: ChangedFile[];
};

/**
 * A stretch of changed lines, as in a `git diff -U0` hunk header: 1-based; a
 * count of 0 means no lines on that side, and its start is the line before.
 */
export type DiffChange = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** Git's hunk header context, e.g. the enclosing function. */
  context: string;
};

export type FileDiff =
  | { kind: "binary"; path: string }
  | {
      kind: "text";
      path: string;
      /** One HTML string per line (highlighted, changed words marked). */
      oldLines: string[];
      newLines: string[];
      changes: DiffChange[];
      /** Markdown only: the rendered document with its changes marked. */
      richHtml: string | null;
    };

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
