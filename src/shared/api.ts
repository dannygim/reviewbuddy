export type Health = { name: "akapen"; version: string; root: string };

export type TreeResponse = { files: string[] };

export type ErrorResponse = { error: string };

export type TextFileView = {
  kind: "code" | "markdown" | "large";
  path: string;
  mtime: number;
  lang: string;
  /** Source lines, without line terminators. */
  lines: string[];
  /** One HTML string per line (highlighted, or escaped for "large"). */
  lineHtml: string[];
};

export type FileView =
  TextFileView | { kind: "image" | "binary"; path: string; mtime: number };
