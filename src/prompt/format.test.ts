import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Thread } from "../shared/api";
import { formatJsonl, formatPrompt } from "./format";

let seq = 0;
function thread(
  path: string,
  lines: [number, number],
  anchorText: string,
  comments: [author: string, body: string][],
  extra: Partial<Thread> = {},
): Thread {
  const id = `t${seq++}`;
  return {
    id,
    path,
    startLine: lines[0],
    endLine: lines[1],
    anchorText,
    originView: "source",
    status: "open",
    outdated: false,
    createdBy: comments[0]![0],
    createdAt: `2026-10-23T06:00:${String(seq).padStart(2, "0")}.000Z`,
    resolvedBy: null,
    resolvedAt: null,
    exportedAt: null,
    comments: comments.map(([author, body], i) => ({
      id: `${id}-c${i}`,
      threadId: id,
      author,
      clientId: author,
      body,
      createdAt: "2026-10-23T06:00:00.000Z",
      updatedAt: null,
    })),
    ...extra,
  };
}

const defaults = { preamble: "", maxAnchorLines: 30 };

/** The example in docs/design/プロンプト出力仕様.md, verbatim. */
function documentedExample(): string {
  const doc = readFileSync(
    join(import.meta.dir, "../../docs/design/プロンプト出力仕様.md"),
    "utf8",
  );
  const start = doc.indexOf("```text\n", doc.indexOf("## 出力例")) + 8;
  return `${doc.slice(start, doc.indexOf("\n```", start))}\n`;
}

describe("formatPrompt", () => {
  test("matches the documented example", () => {
    const threads = [
      thread("mise.toml", [8, 8], 'bun = "1.3.8"', [["Bob", "1.4.4 に上げて"]]),
      thread(
        "doc/B.md",
        [8, 10],
        "- 保存先は `~/.config` 配下\n- ログは標準出力のみ\n- 設定ファイルは TOML",
        [["Bob", "保存先は XDG_CONFIG_HOME を優先するようにしてほしい"]],
      ),
      thread("doc/A.md", [3, 3], "## インストール手順", [
        ["Alice", "Bun の必要バージョンを明記してほしい"],
        ["Bob", "1.4 以上で良いと思う。Rust 版以降の API を使うので"],
        ["Alice", "了解、1.4 以上で"],
      ]),
    ];
    expect(formatPrompt(threads, defaults)).toBe(documentedExample());
  });

  test("indents multi-line comments and keeps blank lines bare", () => {
    const text = formatPrompt(
      [thread("a.md", [1, 3], "one\n\nthree", [["Alice", "first\n\nsecond"]])],
      defaults,
    );
    expect(text).toBe(
      "1. a.md:1-3\n  one\n\n  three\n\n  first\n\n  second by Alice\n",
    );
  });

  test("omits the middle of long selections", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
    const text = formatPrompt(
      [thread("a.ts", [1, 40], lines.join("\n"), [["Bob", "Too long"]])],
      defaults,
    );
    const body = text.split("\n").slice(1, 31);
    expect(body.slice(0, 15)).toEqual(lines.slice(0, 15).map((l) => `  ${l}`));
    expect(body[15]).toBe("  … (11 lines omitted)");
    expect(body.slice(16)).toEqual(lines.slice(26).map((l) => `  ${l}`));

    const exact = formatPrompt(
      [thread("a.ts", [1, 30], lines.slice(0, 30).join("\n"), [["Bob", "ok"]])],
      defaults,
    );
    expect(exact).not.toContain("omitted");
  });

  test("marks outdated threads and adds the preamble", () => {
    const text = formatPrompt(
      [thread("a.ts", [2, 2], "x", [["Bob", "y"]], { outdated: true })],
      { preamble: "Please fix these review comments.", maxAnchorLines: 30 },
    );
    expect(text).toBe(
      "Please fix these review comments.\n\n1. a.ts:2 (outdated)\n  x\n\n  y by Bob\n",
    );
  });

  test("orders by tree order, then line, then creation", () => {
    const text = formatPrompt(
      [
        thread("README.md", [1, 1], "r", [["A", "r"]]),
        thread("src/b.ts", [9, 9], "b9", [["A", "b9"]]),
        thread("src/b.ts", [2, 2], "b2 later", [["A", "later"]]),
        thread("src/b.ts", [2, 2], "b2", [["A", "earlier"]], {
          createdAt: "2026-10-01T00:00:00.000Z",
        }),
      ],
      defaults,
    );
    const headers = text.split("\n").filter((l) => /^\d+\. /.test(l));
    expect(headers).toEqual([
      "1. src/b.ts:2",
      "2. src/b.ts:2",
      "3. src/b.ts:9",
      "4. README.md:1",
    ]);
    expect(text.indexOf("earlier")).toBeLessThan(text.indexOf("later"));
  });

  test("is empty without threads", () => {
    expect(formatPrompt([], defaults)).toBe("");
  });
});

describe("formatJsonl", () => {
  test("writes one JSON object per thread", () => {
    const lines = formatJsonl([
      thread("b.md", [2, 2], "x", [["Bob", "y"]]),
      thread("a.md", [1, 1], "z", [["Alice", "w"]]),
    ])
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.map((l) => l.path)).toEqual(["a.md", "b.md"]);
    expect(Object.keys(lines[0])).toEqual([
      "id",
      "path",
      "startLine",
      "endLine",
      "status",
      "outdated",
      "anchorText",
      "originView",
      "createdBy",
      "createdAt",
      "resolvedBy",
      "resolvedAt",
      "exportedAt",
      "comments",
    ]);
    expect(Object.keys(lines[0].comments[0])).toEqual([
      "id",
      "author",
      "body",
      "createdAt",
      "updatedAt",
    ]);
  });
});
