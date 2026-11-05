import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { git, gitRepo, writeFiles } from "../../test/support";
import { FileIndex } from "../files/file-index";
import type { FileDiff } from "../shared/api";
import { listChanges } from "./changes";
import { parseHunkHeaders, renderDiff } from "./file-diff";

describe("parseHunkHeaders", () => {
  test("reads starts, counts (1 when left out) and the context", () => {
    const patch = [
      "diff --git a/x b/x",
      "@@ -2 +2 @@ function main()",
      "-b",
      "+B",
      "@@ -3,0 +4,2 @@",
      "+d",
      "+e",
      "@@ -10,3 +11,0 @@ class A",
    ].join("\n");
    expect(parseHunkHeaders(patch)).toEqual([
      {
        oldStart: 2,
        oldCount: 1,
        newStart: 2,
        newCount: 1,
        context: "function main()",
      },
      { oldStart: 3, oldCount: 0, newStart: 4, newCount: 2, context: "" },
      {
        oldStart: 10,
        oldCount: 3,
        newStart: 11,
        newCount: 0,
        context: "class A",
      },
    ]);
  });
});

describe("renderDiff", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  async function diffOf(
    files: Record<string, string>,
    edit: (root: string) => void,
    path: string,
  ): Promise<FileDiff> {
    const root = gitRepo(files);
    roots.push(root);
    edit(root);
    const index = await FileIndex.create(root);
    const change = (await listChanges(root, index)).files.find(
      (f) => f.path === path,
    )!;
    const newPath =
      change.status === "deleted" ? null : join(root, change.path);
    return renderDiff(root, change, newPath, {
      maxHighlightBytes: 2_000_000,
      isListed: () => false,
    });
  }

  const text = (html: string) =>
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  const marked = (html: string) =>
    [...html.matchAll(/<span class="diff-word">([^<]*)<\/span>/g)].map(
      (m) => m[1],
    );

  test("returns both sides, the changes from git and the changed words", async () => {
    const diff = await diffOf(
      { "a.ts": "const a = 1;\nconst b = 2;\nkeep();\n" },
      (root) =>
        writeFiles(root, {
          "a.ts": "const a = 1;\nconst b = 3;\nkeep();\nmore();\n",
        }),
      "a.ts",
    );
    if (diff.kind !== "text") throw new Error("expected text");
    expect(diff.oldLines.map(text)).toEqual([
      "const a = 1;",
      "const b = 2;",
      "keep();",
    ]);
    expect(diff.newLines.map(text)).toEqual([
      "const a = 1;",
      "const b = 3;",
      "keep();",
      "more();",
    ]);
    expect(diff.changes).toEqual([
      {
        oldStart: 2,
        oldCount: 1,
        newStart: 2,
        newCount: 1,
        context: "const a = 1;",
      },
      {
        oldStart: 3,
        oldCount: 0,
        newStart: 4,
        newCount: 1,
        context: "keep();",
      },
    ]);
    expect(marked(diff.oldLines[1]!)).toEqual(["2"]);
    expect(marked(diff.newLines[1]!)).toEqual(["3"]);
    expect(diff.richHtml).toBeNull();
  });

  test("shows an untracked file as all added", async () => {
    const diff = await diffOf(
      { "a.txt": "a\n" },
      (root) => writeFiles(root, { "new.txt": "x\ny\n" }),
      "new.txt",
    );
    expect(diff).toMatchObject({
      kind: "text",
      oldLines: [],
      newLines: ["x", "y"],
      changes: [
        { oldStart: 0, oldCount: 0, newStart: 1, newCount: 2, context: "" },
      ],
    });
  });

  test("shows a deleted file as all deleted", async () => {
    const diff = await diffOf(
      { "a.txt": "a\nb\n" },
      (root) => rmSync(join(root, "a.txt")),
      "a.txt",
    );
    expect(diff).toMatchObject({
      kind: "text",
      oldLines: ["a", "b"],
      newLines: [],
      changes: [
        { oldStart: 1, oldCount: 2, newStart: 0, newCount: 0, context: "" },
      ],
    });
  });

  test("compares a renamed file with its old path", async () => {
    const diff = await diffOf(
      { "old.txt": "1\n2\n3\n4\n5\n" },
      (root) => {
        git(root, "mv", "old.txt", "new.txt");
        writeFiles(root, { "new.txt": "1\n2\n3\n4\nfive\n" });
      },
      "new.txt",
    );
    expect(diff).toMatchObject({
      kind: "text",
      oldLines: ["1", "2", "3", "4", "5"],
      changes: [{ oldStart: 5, oldCount: 1, newStart: 5, newCount: 1 }],
    });
  });

  test("renders the changes of a Markdown file", async () => {
    const diff = await diffOf(
      { "doc.md": "# Title\n\nHello world\n" },
      (root) => writeFiles(root, { "doc.md": "# Title\n\nHello there\n" }),
      "doc.md",
    );
    if (diff.kind !== "text") throw new Error("expected text");
    expect(diff.richHtml).toContain("<del>world</del><ins>there</ins>");
  });

  test("does not show binary files or images", async () => {
    const bin = await diffOf(
      { "a.bin": "\0a" },
      (root) => writeFiles(root, { "a.bin": "\0b" }),
      "a.bin",
    );
    expect(bin).toEqual({ kind: "binary", path: "a.bin" });
    const png = await diffOf(
      { "a.png": "x" },
      (root) => writeFiles(root, { "a.png": "y" }),
      "a.png",
    );
    expect(png).toEqual({ kind: "binary", path: "a.png" });
  });
});
