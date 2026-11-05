import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitRepo, writeFiles } from "../../test/support";
import { FileIndex } from "../files/file-index";
import type { ChangedFile } from "../shared/api";
import { listChanges } from "./changes";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  const root = gitRepo(files);
  roots.push(root);
  return root;
}

async function changes(root: string, exclude: string[] = []) {
  return listChanges(root, await FileIndex.create(root, { exclude }));
}

const summary = (files: ChangedFile[]) =>
  files.map(({ path, oldPath, status, additions, deletions }) => ({
    path,
    oldPath,
    status,
    additions,
    deletions,
  }));

describe("listChanges", () => {
  test("lists modified, added, untracked, deleted and renamed files in tree order", async () => {
    const root = repo({
      "src/main.ts": "a\nb\nc\n",
      "src/old.ts": "keep\n",
      "gone.md": "x\ny\n",
      "README.md": "hi\n",
    });
    writeFiles(root, {
      "src/main.ts": "a\nB\nc\nd\n",
      "staged.ts": "one\ntwo\n",
      "notes.txt": "n\n",
    });
    git(root, "add", "staged.ts");
    git(root, "mv", "src/old.ts", "src/new.ts");
    rmSync(join(root, "gone.md"));

    const result = await changes(root);
    expect(result.git).toBe(true);
    expect(summary(result.files)).toEqual([
      {
        path: "src/main.ts",
        oldPath: null,
        status: "modified",
        additions: 2,
        deletions: 1,
      },
      {
        path: "src/new.ts",
        oldPath: "src/old.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
      },
      {
        path: "gone.md",
        oldPath: null,
        status: "deleted",
        additions: 0,
        deletions: 2,
      },
      {
        path: "notes.txt",
        oldPath: null,
        status: "added",
        additions: 1,
        deletions: 0,
      },
      {
        path: "staged.ts",
        oldPath: null,
        status: "added",
        additions: 2,
        deletions: 0,
      },
    ]);
  });

  test("leaves out files that were only touched, ignored or excluded", async () => {
    const root = repo({
      "a.txt": "same\n",
      ".gitignore": "*.log\n",
      "b.lock": "1\n",
    });
    const past = new Date(Date.now() + 5000);
    utimesSync(join(root, "a.txt"), past, past);
    writeFiles(root, {
      "debug.log": "x\n",
      "b.lock": "2\n",
      "c.lock": "new\n",
    });
    expect((await changes(root, ["*.lock"])).files).toEqual([]);
  });

  test("does not write the index", async () => {
    const root = repo({ "a.txt": "same\n" });
    const past = new Date(Date.now() + 5000);
    utimesSync(join(root, "a.txt"), past, past);
    const before = statSync(join(root, ".git/index")).mtimeMs;
    await changes(root);
    expect(statSync(join(root, ".git/index")).mtimeMs).toBe(before);
  });

  test("counts no lines for binary files", async () => {
    const root = repo({ "img.bin": "\0\x01" });
    writeFileSync(join(root, "img.bin"), "\0\x02");
    writeFileSync(join(root, "new.bin"), "\0\x03");
    expect(summary((await changes(root)).files)).toEqual([
      {
        path: "img.bin",
        oldPath: null,
        status: "modified",
        additions: null,
        deletions: null,
      },
      {
        path: "new.bin",
        oldPath: null,
        status: "added",
        additions: null,
        deletions: null,
      },
    ]);
  });

  test("uses paths relative to a root inside the repository", async () => {
    const top = repo({ "sub/x.txt": "a\n", "outside.txt": "o\n" });
    writeFiles(top, {
      "sub/x.txt": "b\n",
      "sub/y.txt": "y\n",
      "outside.txt": "p\n",
    });
    expect(summary((await changes(join(top, "sub"))).files)).toEqual([
      {
        path: "x.txt",
        oldPath: null,
        status: "modified",
        additions: 1,
        deletions: 1,
      },
      {
        path: "y.txt",
        oldPath: null,
        status: "added",
        additions: 1,
        deletions: 0,
      },
    ]);
  });

  test("lists every file as added before the first commit", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "reviewbuddy-git-")));
    roots.push(root);
    git(root, "init", "-q");
    writeFiles(root, { "a.txt": "1\n2\n", "empty.txt": "" });
    expect(summary((await changes(root)).files)).toEqual([
      {
        path: "a.txt",
        oldPath: null,
        status: "added",
        additions: 2,
        deletions: 0,
      },
      {
        path: "empty.txt",
        oldPath: null,
        status: "added",
        additions: 0,
        deletions: 0,
      },
    ]);
  });

  test("reports no Git outside a work tree", async () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "reviewbuddy-nogit-")),
    );
    roots.push(root);
    writeFiles(root, { "a.txt": "1\n" });
    expect(await changes(root)).toEqual({ git: false, files: [] });
  });

  test("changes the version when the change changes", async () => {
    const root = repo({ "a.txt": "1\n" });
    writeFiles(root, { "a.txt": "2\n" });
    const first = (await changes(root)).files[0]!.version;
    expect((await changes(root)).files[0]!.version).toBe(first);
    writeFiles(root, { "a.txt": "3\n" });
    expect((await changes(root)).files[0]!.version).not.toBe(first);
  });
});
