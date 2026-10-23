import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderFile } from "./file-view";

const dir = mkdtempSync(join(tmpdir(), "akapen-view-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, content: string | Uint8Array): string {
  writeFileSync(join(dir, name), content);
  return join(dir, name);
}

const options = { maxHighlightBytes: 100 };

describe("renderFile", () => {
  test("highlights code", async () => {
    const view = await renderFile(
      file("a.ts", "const a = 1;\n"),
      "a.ts",
      options,
    );
    expect(view).toMatchObject({
      kind: "code",
      path: "a.ts",
      lang: "typescript",
      lines: ["const a = 1;"],
    });
    if (view.kind !== "code") throw new Error("unreachable");
    expect(view.lineHtml[0]).toContain("--shiki-dark");
    expect(view.mtime).toBeGreaterThan(0);
  });

  test("treats Markdown as its own kind", async () => {
    const view = await renderFile(file("R.md", "# Hi\n"), "R.md", options);
    expect(view).toMatchObject({
      kind: "markdown",
      lang: "markdown",
      lines: ["# Hi"],
    });
    if (view.kind !== "markdown") throw new Error("unreachable");
    expect(view.previewHtml).toContain(
      '<h1 data-src-start="1" data-src-end="1">Hi</h1>',
    );
  });

  test("detects images by extension", async () => {
    const view = await renderFile(
      file("logo.png", new Uint8Array([137, 80, 78, 71])),
      "logo.png",
      options,
    );
    expect(view).toMatchObject({ kind: "image", path: "logo.png" });
  });

  test("detects binary files by a NUL byte", async () => {
    const view = await renderFile(
      file("x.dat", new Uint8Array([65, 0, 66])),
      "x.dat",
      options,
    );
    expect(view).toMatchObject({ kind: "binary", path: "x.dat" });
  });

  test("does not highlight files over the size limit", async () => {
    const atLimit = await renderFile(
      file("ok.ts", "x".repeat(100)),
      "ok.ts",
      options,
    );
    expect(atLimit.kind).toBe("code");
    const over = await renderFile(
      file("big.ts", "<".repeat(101)),
      "big.ts",
      options,
    );
    expect(over).toMatchObject({
      kind: "large",
      lines: ["<".repeat(101)],
      lineHtml: ["&lt;".repeat(101)],
    });
  });

  test("caches by path, mtime and size", async () => {
    const abs = file("c.ts", "let x = 1;\n");
    const first = await renderFile(abs, "c.ts", options);
    expect(await renderFile(abs, "c.ts", options)).toBe(first);
    writeFileSync(abs, "let x = 12;\n");
    const second = await renderFile(abs, "c.ts", options);
    expect(second).not.toBe(first);
    expect(second).toMatchObject({ lines: ["let x = 12;"] });
  });
});
