export type Health = { name: "akapen"; version: string; root: string };

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
