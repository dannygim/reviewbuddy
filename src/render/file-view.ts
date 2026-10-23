import { statSync } from "node:fs";
import type { FileView } from "../shared/api";
import { highlightLines, splitLines } from "./highlight";
import { escapeHtml } from "./html";
import { detectLanguage } from "./language";
import { renderMarkdown } from "./markdown";

export type RenderOptions = {
  maxHighlightBytes: number;
  /** Whether a root-relative path is listed; used to rewrite Markdown links. */
  isListed?: (path: string) => boolean;
};

export const DEFAULT_MAX_HIGHLIGHT_BYTES = 2_000_000;

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
  "avif",
]);
const CACHE_SIZE = 200;
const cache = new Map<string, FileView>();

export function isImagePath(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return path.includes(".") && IMAGE_EXTENSIONS.has(ext);
}

export async function renderFile(
  absPath: string,
  path: string,
  options: RenderOptions,
): Promise<FileView> {
  const stat = statSync(absPath);
  const key = `${path}\0${stat.mtimeMs}\0${stat.size}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const view = await render(absPath, path, stat, options);
  cache.set(key, view);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return view;
}

async function render(
  absPath: string,
  path: string,
  stat: { mtimeMs: number; size: number; isFile(): boolean },
  options: RenderOptions,
): Promise<FileView> {
  const mtime = stat.mtimeMs;
  if (isImagePath(path)) return { kind: "image", path, mtime };
  const file = Bun.file(absPath);
  if (!stat.isFile() || (await file.slice(0, 8192).bytes()).includes(0)) {
    return { kind: "binary", path, mtime };
  }
  const text = await file.text();
  const lines = splitLines(text);
  const lang = detectLanguage(path);
  if (stat.size > options.maxHighlightBytes) {
    return {
      kind: "large",
      path,
      mtime,
      lang,
      lines,
      lineHtml: lines.map(escapeHtml),
    };
  }
  const lineHtml = await highlightLines(lines, lang);
  if (lang !== "markdown") {
    return { kind: "code", path, mtime, lang, lines, lineHtml };
  }
  const isListed = options.isListed ?? (() => false);
  const previewHtml = await renderMarkdown(text, { path, isListed });
  return { kind: "markdown", path, mtime, lang, lines, lineHtml, previewHtml };
}
