import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitRepo, writeFiles } from "../../test/support";
import { baseCommit, listBranches } from "./branches";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * On `feature`, one commit ahead of `main`; `origin/main` is where main is and
 * `origin/HEAD` points at it; `lonely` has no common ancestor with HEAD.
 */
function repo() {
  const root = gitRepo({ "a.txt": "1\n" });
  roots.push(root);
  git(root, "branch", "-q", "-M", "main");
  const main = git(root, "rev-parse", "HEAD").trim();
  git(root, "update-ref", "refs/remotes/origin/main", main);
  git(
    root,
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
  );
  const tree = git(root, "rev-parse", "HEAD^{tree}").trim();
  const lonely = git(root, "commit-tree", tree, "-m", "lonely").trim();
  git(root, "update-ref", "refs/heads/lonely", lonely);
  git(root, "checkout", "-q", "-b", "feature");
  writeFiles(root, { "a.txt": "2\n" });
  git(root, "commit", "-q", "-am", "feature");
  return { root, main };
}

describe("listBranches", () => {
  test("lists local and remote branches without the current one and symrefs", async () => {
    const { root } = repo();
    expect(await listBranches(root)).toEqual([
      { name: "lonely", ref: "refs/heads/lonely", remote: false },
      { name: "main", ref: "refs/heads/main", remote: false },
      { name: "origin/main", ref: "refs/remotes/origin/main", remote: true },
    ]);
  });

  test("lists nothing outside Git", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "reviewbuddy-")));
    roots.push(root);
    expect(await listBranches(root)).toEqual([]);
  });
});

describe("baseCommit", () => {
  test("is HEAD without a branch, and where HEAD left a branch with one", async () => {
    const { root, main } = repo();
    expect(await baseCommit(root, null)).toBe(
      git(root, "rev-parse", "HEAD").trim(),
    );
    expect(await baseCommit(root, "refs/heads/main")).toBe(main);
    expect(await baseCommit(root, "refs/remotes/origin/main")).toBe(main);
  });

  test("is null for a branch with no common ancestor", async () => {
    const { root } = repo();
    expect(await baseCommit(root, "refs/heads/lonely")).toBeNull();
  });
});

test("does not write the index", async () => {
  const { root } = repo();
  const past = new Date(Date.now() + 5000);
  utimesSync(join(root, "a.txt"), past, past);
  const before = statSync(join(root, ".git/index")).mtimeMs;
  await listBranches(root);
  await baseCommit(root, "refs/heads/main");
  expect(statSync(join(root, ".git/index")).mtimeMs).toBe(before);
});
