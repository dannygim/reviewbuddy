import { describe, expect, test } from "bun:test";
import { highlightLines, splitLines } from "./highlight";

describe("splitLines", () => {
  test("does not count a final newline as an extra line", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
  });

  test("normalizes CRLF", () => {
    expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
  });

  test("keeps blank lines and an empty file as one line", () => {
    expect(splitLines("a\n\nb")).toEqual(["a", "", "b"]);
    expect(splitLines("")).toEqual([""]);
  });
});

describe("highlightLines", () => {
  test("returns one HTML string per line with dual-theme colors", async () => {
    const html = await highlightLines(
      ["const a = 1;", "", "// <b>"],
      "typescript",
    );
    expect(html).toHaveLength(3);
    expect(html[0]).toContain(
      '<span style="color:#D73A49;--shiki-dark:#F97583">const</span>',
    );
    expect(html[1]).toBe("");
    expect(html[2]).toContain("// &lt;b&gt;");
    expect(html[2]).not.toContain("<b>");
  });

  test("escapes plain text for unknown languages", async () => {
    expect(await highlightLines(["<a href='x'>&</a>"], "text")).toEqual([
      "&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;",
    ]);
  });
});
