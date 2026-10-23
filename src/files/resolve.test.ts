import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileIndex } from "./file-index";
import { resolveFile } from "./resolve";

const base = realpathSync(mkdtempSync(join(tmpdir(), "akapen-resolve-")));
const root = join(base, "root");
mkdirSync(join(root, "doc"), { recursive: true });
writeFileSync(join(root, "doc/a.md"), "a");
writeFileSync(join(base, "outside.txt"), "secret");
symlinkSync(join(base, "outside.txt"), join(root, "link.txt"));
symlinkSync("doc/a.md", join(root, "inside-link.md"));
const index = await FileIndex.create(root);

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("resolveFile", () => {
  test("resolves a listed file inside the root", () => {
    expect(resolveFile(root, index, "doc/a.md")).toBe(join(root, "doc/a.md"));
  });

  test("follows a symlink that stays inside the root", () => {
    expect(resolveFile(root, index, "inside-link.md")).toBe(
      join(root, "doc/a.md"),
    );
  });

  test("rejects a listed symlink that points outside the root", () => {
    expect(index.has("link.txt")).toBe(true);
    expect(resolveFile(root, index, "link.txt")).toBeNull();
  });

  test.each([["../outside.txt"], ["/etc/passwd"], ["doc/missing.md"], [""]])(
    "rejects %p",
    (path) => {
      expect(resolveFile(root, index, path)).toBeNull();
    },
  );
});
