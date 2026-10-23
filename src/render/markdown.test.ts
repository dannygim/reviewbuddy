import { describe, expect, test } from "bun:test";
import { fenceLanguage, renderMarkdown } from "./markdown";

const listed = new Set(["doc/other.md", "doc/img/logo.png", "README.md"]);
const options = {
  path: "doc/guide.md",
  isListed: (p: string) => listed.has(p),
};
const render = (source: string) => renderMarkdown(source, options);

// The sample measured in docs/research/レンダリング_調査.md.
const SAMPLE = [
  "# Title",
  "",
  "Paragraph line 1",
  "line 2",
  "",
  "- item a",
  "- item b",
  "  - nested",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "| 3 | 4 |",
  "",
  "```mermaid",
  "graph LR",
  "  A-->B",
  "```",
  "",
  "> quote",
  "",
].join("\n");

describe("renderMarkdown source lines", () => {
  test("annotates blocks with 1-based inclusive line ranges", async () => {
    const html = await render(SAMPLE);
    for (const [tag, start, end] of [
      ["h1", 1, 1],
      ["p", 3, 4],
      ["li", 6, 6],
      ["li", 7, 8],
      ["li", 8, 8],
      ["tr", 10, 10],
      ["tr", 12, 12],
      ["tr", 13, 13],
      ["blockquote", 20, 20],
    ] as const) {
      expect(html).toContain(
        `<${tag} data-src-start="${start}" data-src-end="${end}">`,
      );
    }
    expect(html).toContain(
      '<div class="mermaid" data-src-start="15" data-src-end="18">graph LR\n  A--&gt;B\n</div>',
    );
  });

  test("annotates hr and indented code", async () => {
    const html = await render("a\n\n---\n\n    code\n");
    expect(html).toContain('<hr data-src-start="3" data-src-end="3">');
    expect(html).toContain(
      '<pre class="code-block" data-src-start="5" data-src-end="5"><code>code</code></pre>',
    );
  });

  test("leaves raw HTML blocks unwrapped so multi-block HTML keeps its structure", async () => {
    const html = await render(
      "<details>\n<summary>More</summary>\n\nInside\n\n</details>\n",
    );
    expect(html).toContain("<details>\n<summary>More</summary>\n");
    expect(html).toContain('<p data-src-start="4" data-src-end="4">Inside</p>');
  });
});

describe("renderMarkdown syntax", () => {
  test("renders task lists as disabled checkboxes", async () => {
    const html = await render("- [ ] todo\n- [x] done\n");
    expect(html).toContain(
      '<li data-src-start="1" data-src-end="1" class="task-list-item"><input type="checkbox" disabled> todo</li>',
    );
    expect(html).toContain('<input type="checkbox" disabled checked> done');
  });

  test("renders tables, strikethrough and bare URLs", async () => {
    const html = await render(
      "| x |\n|---|\n| y |\n\n~~old~~ https://example.com\n",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<s>old</s>");
    expect(html).toContain('href="https://example.com"');
  });

  test("highlights fenced code with a known language", async () => {
    const html = await render("```ts\nconst a = 1;\n```\n");
    expect(html).toContain(
      '<pre class="code-block" data-src-start="1" data-src-end="3"><code><span style="color:#D73A49;--shiki-dark:#F97583">const</span>',
    );
  });

  test("escapes fenced code without a language", async () => {
    const html = await render("```\n<b>\n```\n");
    expect(html).toContain("<code>&lt;b&gt;</code>");
  });
});

describe("renderMarkdown links", () => {
  test("turns relative links to listed files into in-app links", async () => {
    const html = await render("[o](./other.md) [r](../README.md#top)");
    expect(html).toContain('href="#/doc/doc/other.md"');
    expect(html).toContain('href="#/doc/README.md"');
  });

  test("keeps links to files that are not listed", async () => {
    expect(await render("[m](missing.md)")).toContain('href="missing.md"');
  });

  test("opens external links in a new tab", async () => {
    expect(await render("[e](https://example.com)")).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">',
    );
  });

  test("serves relative images through /api/raw", async () => {
    expect(await render("![logo](img/logo.png)")).toContain(
      'src="/api/raw?path=doc%2Fimg%2Flogo.png"',
    );
  });
});

describe("fenceLanguage", () => {
  test.each([
    ["ts", "typescript"],
    ["typescript", "typescript"],
    ["sh", "shellscript"],
    ["bash", "shellscript"],
    ["shell", "shellscript"],
    ["yml", "yaml"],
    ["dockerfile", "docker"],
    ["mermaid", "mermaid"],
    ["ts title=x.ts", "typescript"],
    ["", "text"],
    ["brainfuck", "text"],
  ])("%p is %p", (info, lang) => {
    expect(fenceLanguage(info)).toBe(lang);
  });
});
