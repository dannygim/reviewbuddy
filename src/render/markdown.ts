import MarkdownIt from "markdown-it";
import type { Renderer, Token } from "markdown-it";
import { posix } from "node:path";
import { hashForDocPath } from "../shared/doc-link";
import { highlightLines, splitLines } from "./highlight";
import { escapeHtml } from "./html";
import { detectLanguage, LANGUAGES } from "./language";

export type MarkdownOptions = {
  /** Path of the Markdown file, relative to the root. */
  path: string;
  /** Whether a root-relative path is in the file index. */
  isListed: (path: string) => boolean;
};

// Block tokens whose elements get data-src-start / data-src-end. Raw HTML
// blocks are left alone: wrapping them would break HTML that spans several
// blocks, such as <details>.
const SOURCE_MAPPED = new Set([
  "heading_open",
  "paragraph_open",
  "list_item_open",
  "tr_open",
  "blockquote_open",
  "fence",
  "code_block",
  "hr",
]);
const FENCE_ALIASES: Record<string, string> = {
  shell: "shellscript",
  console: "shellscript",
  dockerfile: "docker",
  makefile: "make",
  mermaid: "mermaid",
};
const TASK = /^\[([ xX])\] /;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const md = new MarkdownIt({ html: true, linkify: true });

// markdown-it maps are 0-based and end-exclusive, and lists include the blank
// lines that follow them; convert to 1-based inclusive ranges without those.
md.core.ruler.push("akapen_source_lines", (state) => {
  const lines = state.src.split("\n");
  for (const token of state.tokens) {
    if (!token.map || !SOURCE_MAPPED.has(token.type)) continue;
    const [start, end] = token.map;
    let last = end;
    while (last > start + 1 && lines[last - 1]!.trim() === "") last--;
    token.attrSet("data-src-start", String(start + 1));
    token.attrSet("data-src-end", String(last));
  }
});

md.core.ruler.push("akapen_task_lists", (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]!;
    if (
      inline.type !== "inline" ||
      tokens[i - 1]!.type !== "paragraph_open" ||
      tokens[i - 2]!.type !== "list_item_open"
    )
      continue;
    const first = inline.children?.[0];
    const match = first?.type === "text" ? TASK.exec(first.content) : null;
    if (!first || !match) continue;
    first.content = first.content.slice(match[0].length);
    const box = new state.Token("html_inline", "", 0);
    box.content = `<input type="checkbox" disabled${match[1] === " " ? "" : " checked"}> `;
    inline.children!.unshift(box);
    tokens[i - 2]!.attrJoin("class", "task-list-item");
  }
});

const rules = md.renderer.rules;
const renderImage = rules.image!;

function codeBlock(token: Token, self: Renderer): string {
  const meta = token.meta as { lineHtml?: string[] } | null;
  const lines = meta?.lineHtml ?? splitLines(token.content).map(escapeHtml);
  return `<pre class="code-block"${self.renderAttrs(token)}><code>${lines.join("\n")}</code></pre>\n`;
}

rules.fence = (tokens, idx, _options, _env, self) => {
  const token = tokens[idx]!;
  if (fenceLanguage(token.info) === "mermaid") {
    return `<div class="mermaid"${self.renderAttrs(token)}>${escapeHtml(token.content)}</div>\n`;
  }
  return codeBlock(token, self);
};

rules.code_block = (tokens, idx, _options, _env, self) =>
  codeBlock(tokens[idx]!, self);

rules.link_open = (tokens, idx, options, env, self) => {
  const { path: from, isListed } = env as MarkdownOptions;
  const token = tokens[idx]!;
  const href = String(token.attrGet("href") ?? "");
  if (/^(https?|mailto):/i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  } else {
    const path = resolveRelative(from, href);
    if (path && isListed(path)) token.attrSet("href", hashForDocPath(path));
  }
  return self.renderToken(tokens, idx, options);
};

rules.image = (tokens, idx, options, env, self) => {
  const { path: from, isListed } = env as MarkdownOptions;
  const token = tokens[idx]!;
  const path = resolveRelative(from, String(token.attrGet("src") ?? ""));
  if (path && isListed(path)) {
    token.attrSet("src", `/api/raw?path=${encodeURIComponent(path)}`);
  }
  return renderImage(tokens, idx, options, env, self);
};

/** Resolves a relative link against the Markdown file's directory. */
function resolveRelative(from: string, href: string): string | null {
  if (!href || href.startsWith("#") || href.startsWith("/")) return null;
  if (SCHEME.test(href)) return null;
  let target = href.replace(/[?#].*$/, "");
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  const path = posix.normalize(posix.join(posix.dirname(from), target));
  return path.startsWith("../") || path === ".." ? null : path;
}

/** Maps a fence's info string (e.g. "ts title=x.ts") to a Shiki language. */
export function fenceLanguage(info: string): string {
  const name = info.trim().split(/\s+/)[0]!.toLowerCase();
  if (!name) return "text";
  if (FENCE_ALIASES[name]) return FENCE_ALIASES[name];
  if (LANGUAGES.includes(name)) return name;
  return detectLanguage(`fence.${name}`);
}

export async function renderMarkdown(
  source: string,
  options: MarkdownOptions,
): Promise<string> {
  const env = { ...options };
  const tokens = md.parse(source, env);
  // Highlighting is async, so do it before the synchronous render.
  for (const token of tokens) {
    if (token.type !== "fence") continue;
    const lang = fenceLanguage(token.info);
    if (lang === "mermaid" || lang === "text") continue;
    token.meta = {
      lineHtml: await highlightLines(splitLines(token.content), lang),
    };
  }
  return md.renderer.render(tokens, md.options, env);
}
