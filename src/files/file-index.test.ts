import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileIndex, listFiles } from "./file-index";

const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "reviewbuddy-index-"));
  created.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function git(root: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", root, ...args]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

describe("listFiles in a Git repository", () => {
  test("follows Git's ignore rules", async () => {
    const root = fixture({
      ".gitignore": "dist/\n*.log\n",
      "dist/out.js": "",
      "app.log": "",
      "tracked.log": "",
      "sub/.gitignore": "secret.txt\n",
      "sub/secret.txt": "",
      "sub/keep.md": "",
      "localonly.txt": "",
      "untracked.md": "",
      "gone.md": "",
      "README.md": "",
    });
    git(root, "init", "-q");
    writeFileSync(join(root, ".git/info/exclude"), "localonly.txt\n");
    git(root, "add", ".gitignore", "sub", "README.md", "gone.md");
    git(root, "add", "-f", "tracked.log");
    rmSync(join(root, "gone.md"));

    expect(await listFiles(root)).toEqual([
      "sub/.gitignore",
      "sub/keep.md",
      ".gitignore",
      "README.md",
      "tracked.log",
      "untracked.md",
    ]);
  });

  test("lists paths relative to a subdirectory root", async () => {
    const root = fixture({ "sub/a.md": "", "b.md": "" });
    git(root, "init", "-q");
    expect(await listFiles(join(root, "sub"))).toEqual(["a.md"]);
  });

  test("applies extra exclude patterns", async () => {
    const root = fixture({ "bun.lock": "", "a.md": "", "x/y.lock": "" });
    git(root, "init", "-q");
    expect(await listFiles(root, { exclude: ["*.lock"] })).toEqual(["a.md"]);
  });
});

describe("listFiles outside Git", () => {
  test("stacks nested .gitignore files like Git", async () => {
    const root = fixture({
      ".gitignore": "*.log\nbuild/\n",
      "a.md": "",
      "x.log": "",
      "build/o.js": "",
      "pkg/.gitignore": "secret.txt\n!keep.log\n",
      "pkg/secret.txt": "",
      "pkg/keep.log": "",
      "pkg/b.md": "",
      "pkg/inner/secret.txt": "",
    });
    expect(await listFiles(root)).toEqual([
      "pkg/.gitignore",
      "pkg/b.md",
      "pkg/keep.log",
      ".gitignore",
      "a.md",
    ]);
  });

  test("never lists .git", async () => {
    const root = fixture({ ".git/config": "not a repository", "a.md": "" });
    expect(await listFiles(root)).toEqual(["a.md"]);
  });

  test("applies extra exclude patterns", async () => {
    const root = fixture({ "bun.lock": "", "a.md": "" });
    expect(await listFiles(root, { exclude: ["*.lock"] })).toEqual(["a.md"]);
  });
});

describe("FileIndex", () => {
  test("answers membership and reports whether a refresh changed the list", async () => {
    const root = fixture({ "a.md": "" });
    const index = await FileIndex.create(root);
    expect(index.paths()).toEqual(["a.md"]);
    expect(index.has("a.md")).toBe(true);
    expect(index.has("b.md")).toBe(false);

    expect(await index.refresh()).toBe(false);
    writeFileSync(join(root, "b.md"), "");
    expect(await index.refresh()).toBe(true);
    expect(index.has("b.md")).toBe(true);
  });
});

describe("listFiles robustness", () => {
  test("skips directories it cannot read", async () => {
    const root = fixture({ "a.md": "", "locked/secret.md": "" });
    chmodSync(join(root, "locked"), 0o000);
    try {
      expect(await listFiles(root)).toEqual(["a.md"]);
    } finally {
      chmodSync(join(root, "locked"), 0o755);
    }
  });

  test("returns nothing for a root that no longer exists", async () => {
    expect(await listFiles(join(tmpdir(), "reviewbuddy-missing-root"))).toEqual(
      [],
    );
  });
});
