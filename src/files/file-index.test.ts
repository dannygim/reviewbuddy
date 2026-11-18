import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
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

/** The cases of docs/research/gitignore_判定_調査.md, in a real-path root. */
function ignoredRepo(): string {
  const root = realpathSync(
    fixture({
      ".gitignore": "dist/\nnode_modules/\nbuild/\nbuild2/\n*.log\n.env\n",
      "dist/out.js": "",
      "node_modules/pkg/index.js": "",
      "build/keep.txt": "",
      "build/other.txt": "",
      "app.log": "",
      "tracked.log": "",
      ".env": "SECRET=1\n",
      "sub/.gitignore": "secret.txt\n",
      "sub/secret.txt": "",
      "localonly.txt": "",
      "README.md": "",
    }),
  );
  mkdirSync(join(root, "build2"));
  git(root, "init", "-q");
  writeFileSync(join(root, ".git/info/exclude"), "localonly.txt\n");
  git(root, "add", ".");
  git(root, "add", "-f", "build/keep.txt", "tracked.log");
  return root;
}

describe("FileIndex.listIgnored", () => {
  test("lists Git's ignored files, folding ignored directories", async () => {
    const root = ignoredRepo();
    const indexFile = join(root, ".git/index");
    const before = statSync(indexFile).mtimeMs;
    const index = await FileIndex.create(root);

    expect(await index.listIgnored()).toEqual([
      "build/other.txt",
      "dist/",
      "node_modules/",
      "sub/secret.txt",
      ".env",
      "app.log",
      "localonly.txt",
    ]);
    expect(statSync(indexFile).mtimeMs).toBe(before);
  });

  test("leaves out viewer.exclude", async () => {
    const root = ignoredRepo();
    const index = await FileIndex.create(root, { exclude: ["dist", "*.log"] });
    expect(await index.listIgnored()).toEqual([
      "build/other.txt",
      "node_modules/",
      "sub/secret.txt",
      ".env",
      "localonly.txt",
    ]);
  });

  test("stacks nested .gitignore files outside Git", async () => {
    const root = fixture({
      ".gitignore": "*.log\nbuild/\n",
      "a.md": "",
      "x.log": "",
      "build/o.js": "",
      "pkg/.gitignore": "secret.txt\n!keep.log\n",
      "pkg/secret.txt": "",
      "pkg/keep.log": "",
      "pkg/inner/secret.txt": "",
      ".git/config": "not a repository",
    });
    expect(await (await FileIndex.create(root)).listIgnored()).toEqual([
      "build/",
      "pkg/inner/secret.txt",
      "pkg/secret.txt",
      "x.log",
    ]);
    const index = await FileIndex.create(root, { exclude: ["build"] });
    expect(await index.listIgnored()).toEqual([
      "pkg/inner/secret.txt",
      "pkg/secret.txt",
      "x.log",
    ]);
  });
});

describe("FileIndex.listIgnoredDir", () => {
  const root = ignoredRepo();
  symlinkSync(join(root, "dist"), join(root, "node_modules/link"));
  symlinkSync("../README.md", join(root, "node_modules/readme"));
  const index = FileIndex.create(root);

  test("lists one level, symlinks as files", async () => {
    expect((await index).listIgnoredDir("node_modules/")).toEqual([
      "node_modules/pkg/",
      "node_modules/link",
      "node_modules/readme",
    ]);
    expect((await index).listIgnoredDir("node_modules/pkg/")).toEqual([
      "node_modules/pkg/index.js",
    ]);
  });

  test("leaves out viewer.exclude", async () => {
    const excluding = await FileIndex.create(root, { exclude: ["*.js"] });
    expect(excluding.listIgnoredDir("node_modules/pkg/")).toEqual([]);
    expect(excluding.listIgnoredDir(".git/")).toBeNull();
  });

  test.each([
    ["node_modules"],
    ["sub/"],
    ["build/"],
    [""],
    ["/"],
    ["../"],
    ["node_modules/../"],
    ["./node_modules/"],
    ["node_modules//"],
    ["missing/"],
    ["README.md/"],
    ["node_modules/link/"],
    [".git/"],
  ])("rejects %p", async (dir) => {
    expect((await index).listIgnoredDir(dir)).toBeNull();
  });
});

describe("FileIndex.isIgnoredFile", () => {
  const root = ignoredRepo();
  const outside = join(fixture({ "secret.txt": "" }), "secret.txt");
  symlinkSync(join(root, "dist"), join(root, "node_modules/link"));
  symlinkSync("../README.md", join(root, "node_modules/readme"));
  symlinkSync(outside, join(root, "dist/secret.txt"));
  const index = FileIndex.create(root);

  test.each([
    [".env"],
    ["dist/out.js"],
    ["node_modules/pkg/index.js"],
    ["build/other.txt"],
    ["node_modules/readme"],
  ])("accepts %p", async (path) => {
    expect((await index).isIgnoredFile(path)).toBe(true);
  });

  test.each([
    ["README.md"],
    ["missing.md"],
    ["dist"],
    ["dist/"],
    [""],
    ["../x"],
    ["./.env"],
    ["dist/../.env"],
    ["dist//out.js"],
    [".git/config"],
    ["node_modules/link"],
    ["node_modules/link/out.js"],
    ["dist/secret.txt"],
  ])("rejects %p", async (path) => {
    expect((await index).isIgnoredFile(path)).toBe(false);
  });

  test("rejects viewer.exclude", async () => {
    const excluding = await FileIndex.create(root, { exclude: [".env"] });
    expect(excluding.isIgnoredFile(".env")).toBe(false);
  });
});
