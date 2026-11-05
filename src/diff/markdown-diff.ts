import type { Token } from "markdown-it";
import {
  type MarkdownBlock,
  type MarkdownOptions,
  markdownBlocks,
  splitBlocks,
} from "../render/markdown";
import { diffSequences, type Edit } from "./myers";
import { WORD_TOKEN } from "./words";

const HTML_TOKEN = new RegExp(`<[^>]*>|&#?\\w+;|${WORD_TOKEN.source}`, "gsu");
const SOURCE_LINES = / data-src-(?:start|end)="\d+"/g;
/** Above this many changed tokens or blocks, a stretch is replaced as a whole. */
const MAX_COST = 2000;

/** Blocks shown as one block with their changed words marked. */
const INLINE = new Set(["paragraph_open", "heading_open", "blockquote_open"]);
const LISTS = new Set(["bullet_list_open", "ordered_list_open"]);
/** Blocks shown with a bar beside them instead of a background. */
const BARRED = new Set(["table_open", "fence", "code_block", "html_block"]);

type Render = (tokens: Token[]) => string;

/**
 * The new version of a Markdown document, rendered, with the changes from the
 * old version marked (docs/design/差分表示.md). Only blocks of the new version
 * keep data-src-start / data-src-end, so only they can be commented on.
 */
export async function renderMarkdownDiff(
  oldSource: string,
  newSource: string,
  options: MarkdownOptions,
): Promise<string> {
  const before = await markdownBlocks(oldSource, options);
  const after = await markdownBlocks(newSource, options);
  for (const block of before.blocks) {
    for (const token of block.tokens) {
      token.attrs =
        token.attrs?.filter(([name]) => !name.startsWith("data-src-")) ?? null;
    }
  }
  const sides = {
    oldLines: oldSource.split("\n"),
    newLines: newSource.split("\n"),
    renderOld: before.render,
    renderNew: after.render,
  };
  return compareBlocks(
    before.blocks,
    after.blocks,
    (pairs) => pairs.map(([o, n]) => topLevel(o, n, sides)).join(""),
    after.render,
  );
}

type Sides = {
  oldLines: string[];
  newLines: string[];
  renderOld: Render;
  renderNew: Render;
};

/**
 * Renders equal blocks as they are and hands each changed stretch, as pairs
 * of an old and a new block (either may be missing), to `changed`.
 */
function compareBlocks(
  olds: MarkdownBlock[],
  news: MarkdownBlock[],
  changed: (
    pairs: [MarkdownBlock | undefined, MarkdownBlock | undefined][],
  ) => string,
  render: Render,
): string {
  const edits = diffSequences(
    olds.map((b) => b.source),
    news.map((b) => b.source),
    MAX_COST,
  );
  let html = "";
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    if (edit.type === "equal") {
      html += news
        .slice(edit.b, edit.b + edit.count)
        .map((b) => render(b.tokens))
        .join("");
      continue;
    }
    const deleted = edit.type === "delete" ? edit : null;
    const inserted =
      edit.type === "insert"
        ? edit
        : edits[i + 1]?.type === "insert"
          ? edits[++i]!
          : null;
    const dels = deleted
      ? olds.slice(deleted.a, deleted.a + deleted.count)
      : [];
    const ins = inserted
      ? news.slice(inserted.b, inserted.b + inserted.count)
      : [];
    const pairs: [MarkdownBlock | undefined, MarkdownBlock | undefined][] = [];
    for (let j = 0; j < Math.max(dels.length, ins.length); j++)
      pairs.push([dels[j], ins[j]]);
    html += changed(pairs);
  }
  return html;
}

const kind = (block: MarkdownBlock) =>
  `${block.tokens[0]!.type}:${block.tokens[0]!.tag}`;

function topLevel(
  before: MarkdownBlock | undefined,
  after: MarkdownBlock | undefined,
  sides: Sides,
): string {
  const type = (before ?? after)!.tokens[0]!.type;
  if (before && after && kind(before) === kind(after)) {
    if (INLINE.has(type)) {
      const html = htmlDiff(
        sides.renderOld(before.tokens),
        sides.renderNew(after.tokens),
      );
      if (html !== null) return wrap("diff-mod", html);
    } else if (LISTS.has(type)) {
      return wrap("diff-mod", listDiff(before, after, sides));
    }
  }
  const bar = (block: MarkdownBlock) =>
    BARRED.has(block.tokens[0]!.type) ? " diff-bar" : "";
  return (
    (before
      ? wrap(`diff-del${bar(before)}`, sides.renderOld(before.tokens))
      : "") +
    (after ? wrap(`diff-add${bar(after)}`, sides.renderNew(after.tokens)) : "")
  );
}

const wrap = (cls: string, html: string) =>
  `<div class="diff-block ${cls}">${html}</div>`;

/** A list with its items compared one by one. */
function listDiff(
  before: MarkdownBlock,
  after: MarkdownBlock,
  sides: Sides,
): string {
  const items = (block: MarkdownBlock, lines: string[]) =>
    splitBlocks(block.tokens.slice(1, -1), block.tokens[0]!.level + 1, lines);
  const open = after.tokens.slice(0, 1);
  const close = after.tokens.slice(-1);
  const body = compareBlocks(
    items(before, sides.oldLines),
    items(after, sides.newLines),
    (pairs) =>
      pairs
        .map(([o, n]) => {
          const html =
            o && n
              ? htmlDiff(sides.renderOld(o.tokens), sides.renderNew(n.tokens))
              : null;
          if (html !== null) return html;
          return (
            (o ? item(o, "diff-del", sides.renderOld) : "") +
            (n ? item(n, "diff-add", sides.renderNew) : "")
          );
        })
        .join(""),
    sides.renderNew,
  );
  return sides.renderNew(open) + body + sides.renderNew(close);
}

function item(block: MarkdownBlock, cls: string, render: Render): string {
  block.tokens[0]!.attrJoin("class", cls);
  return render(block.tokens);
}

/**
 * The new HTML with the words that changed from the old HTML marked: deleted
 * text in <del>, inserted text in <ins>. All of the new tags are kept and the
 * deleted ones dropped, so the markup stays well formed. Null when the two
 * share no word.
 */
export function htmlDiff(oldHtml: string, newHtml: string): string | null {
  const a = oldHtml.match(HTML_TOKEN) ?? [];
  const b = newHtml.match(HTML_TOKEN) ?? [];
  const key = (token: string) =>
    token.startsWith("<") ? token.replace(SOURCE_LINES, "") : token;
  const edits = diffSequences(a.map(key), b.map(key), MAX_COST);
  const isText = (token: string) => !token.startsWith("<");
  if (
    !edits.some(
      (e) =>
        e.type === "equal" &&
        a.slice(e.a, e.a + e.count).some((t) => isText(t) && t.trim() !== ""),
    )
  ) {
    return null;
  }
  let html = "";
  for (const edit of edits) html += render(edit, a, b, isText);
  return html;
}

function render(
  edit: Edit,
  a: string[],
  b: string[],
  isText: (t: string) => boolean,
): string {
  if (edit.type === "equal")
    return b.slice(edit.b, edit.b + edit.count).join("");
  if (edit.type === "delete") {
    const text = a
      .slice(edit.a, edit.a + edit.count)
      .filter(isText)
      .join("");
    return text ? `<del>${text}</del>` : "";
  }
  let html = "";
  let open = false;
  for (const token of b.slice(edit.b, edit.b + edit.count)) {
    if (isText(token) !== open) {
      html += open ? "</ins>" : "<ins>";
      open = !open;
    }
    html += token;
  }
  return open ? `${html}</ins>` : html;
}
