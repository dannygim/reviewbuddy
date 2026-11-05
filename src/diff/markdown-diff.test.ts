import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../render/markdown";
import { htmlDiff, renderMarkdownDiff } from "./markdown-diff";

const options = { path: "doc.md", isListed: () => false };
const diff = (before: string, after: string) =>
  renderMarkdownDiff(before, after, options);

/** The wrapper blocks of a given class, with their contents. */
const wrapped = (html: string, cls: string) =>
  [
    ...html.matchAll(new RegExp(`<div class="${cls}">([\\s\\S]*?)</div>`, "g")),
  ].map((m) => m[1]!);

describe("htmlDiff", () => {
  test("marks deleted and inserted words inside the new markup", () => {
    expect(
      htmlDiff(
        "<p>Hello world</p>",
        '<p data-src-start="1" data-src-end="1">Hello there</p>',
      ),
    ).toBe(
      '<p data-src-start="1" data-src-end="1">Hello <del>world</del><ins>there</ins></p>',
    );
  });

  test("keeps the new tags and drops the deleted ones", () => {
    expect(
      htmlDiff("<p>use <code>a</code> now</p>", "<p>use <em>b</em> now</p>"),
    ).toBe("<p>use <del>a</del><em><ins>b</ins></em> now</p>");
  });

  test("keeps a tag whole when a quoted attribute contains >", () => {
    // Raw HTML in Markdown reaches the diff as written.
    expect(
      htmlDiff(
        '<p>x <span title="a > b">y</span></p>',
        "<p>x <span title='c > d'>y</span></p>",
      ),
    ).toBe("<p>x <span title='c > d'>y</span></p>");
  });
});

describe("renderMarkdownDiff", () => {
  test("renders an unchanged document like the preview", async () => {
    const source = "# Title\n\nBody\n\n- a\n- b\n";
    expect(await diff(source, source)).toBe(
      await renderMarkdown(source, options),
    );
  });

  test("marks an added paragraph and keeps its source lines", async () => {
    const html = await diff("# T\n\nA\n", "# T\n\nA\n\nB\n");
    expect(wrapped(html, "diff-block diff-add")).toEqual([
      '<p data-src-start="5" data-src-end="5">B</p>\n',
    ]);
  });

  test("marks a deleted paragraph without source lines", async () => {
    const html = await diff("# T\n\nA\n\nB\n", "# T\n\nA\n");
    expect(wrapped(html, "diff-block diff-del")).toEqual(["<p>B</p>\n"]);
  });

  test("shows the changed words of a paragraph", async () => {
    const html = await diff("Hello world\n", "Hello there\n");
    expect(wrapped(html, "diff-block diff-mod")).toEqual([
      '<p data-src-start="1" data-src-end="1">Hello <del>world</del><ins>there</ins></p>\n',
    ]);
  });

  test("does not pair headings of different levels", async () => {
    const html = await diff("# A\n", "## A\n");
    expect(wrapped(html, "diff-block diff-del")).toEqual(["<h1>A</h1>\n"]);
    expect(wrapped(html, "diff-block diff-add")).toEqual([
      '<h2 data-src-start="1" data-src-end="1">A</h2>\n',
    ]);
  });

  test("compares the items of a changed list", async () => {
    const html = await diff(
      "- keep\n- old one\n- gone\n",
      "- keep\n- new one\n- added\n",
    );
    const [list] = wrapped(html, "diff-block diff-mod");
    expect(list).toContain('<li data-src-start="1" data-src-end="1">keep</li>');
    expect(list).toContain(
      '<li data-src-start="2" data-src-end="2"><del>old</del><ins>new</ins> one</li>',
    );
    expect(list).toContain('<li class="diff-del">gone</li>');
    expect(list).toContain(
      '<li data-src-start="3" data-src-end="3" class="diff-add">added</li>',
    );
  });

  test("shows a changed table as the old one and the new one", async () => {
    const html = await diff("| a |\n|---|\n| 1 |\n", "| a |\n|---|\n| 2 |\n");
    const [before] = wrapped(html, "diff-block diff-del diff-bar");
    const [after] = wrapped(html, "diff-block diff-add diff-bar");
    expect(before).toContain("<td>1</td>");
    expect(before).not.toContain("data-src");
    expect(after).toContain("<td>2</td>");
    expect(after).toContain("data-src-start");
  });
});
