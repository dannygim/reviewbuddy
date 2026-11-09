import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  git,
  gitRepo,
  TEST_TOKEN,
  testSession,
  writeFiles,
} from "../test/support";
import { FileIndex } from "./files/file-index";
import { type AppServer, startServer } from "./server";
import type { BranchesResponse, ChangesResponse, FileDiff } from "./shared/api";
import type { ServerEvent } from "./shared/events";

const roots: string[] = [];
const servers: AppServer[] = [];
afterAll(async () => {
  for (const server of servers) await server.stop(true);
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function serve(files: Record<string, string>, watch = false) {
  const root = gitRepo(files);
  roots.push(root);
  return { root, ...(await start(root, watch)) };
}

async function start(root: string, watch: boolean) {
  const server = startServer({
    root,
    host: "127.0.0.1",
    port: 0,
    strictPort: true,
    index: await FileIndex.create(root),
    allowedHosts: [],
    maxHighlightBytes: 2_000_000,
    session: testSession(),
    watch,
  });
  servers.push(server);
  const get = async <T>(path: string) => {
    const res = await fetch(new URL(path, server.url));
    return { status: res.status, body: (await res.json()) as T };
  };
  return { server, get };
}

describe("GET /api/changes and /api/diff", () => {
  test("lists the changed files and returns the diff of one", async () => {
    const { root, get } = await serve({ "a.ts": "x;\n", "b.ts": "y;\n" });
    writeFiles(root, { "a.ts": "x;\nz;\n" });

    const changes = await get<ChangesResponse>("/api/changes");
    expect(changes.status).toBe(200);
    expect(changes.body.git).toBe(true);
    expect(changes.body.files.map((f) => [f.path, f.status])).toEqual([
      ["a.ts", "modified"],
    ]);

    const diff = await get<FileDiff>("/api/diff?path=a.ts");
    expect(diff.status).toBe(200);
    expect(diff.body).toMatchObject({
      kind: "text",
      path: "a.ts",
      changes: [{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 1 }],
    });
  });

  test("returns 404 for a path that has no changes", async () => {
    const { get } = await serve({ "a.ts": "x;\n" });
    expect((await get("/api/diff?path=a.ts")).status).toBe(404);
    expect((await get("/api/diff?path=../etc/passwd")).status).toBe(404);
  });
});

describe("comparing with a branch", () => {
  /** On `feature`, a commit ahead of `main` (also `origin/main`), with a.ts edited. */
  async function serveFeature() {
    const served = await serve({ "a.ts": "x;\n", "b.ts": "y;\n" });
    const { root } = served;
    git(root, "branch", "-q", "-M", "main");
    git(root, "update-ref", "refs/remotes/origin/main", "main");
    git(
      root,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    );
    git(root, "checkout", "-q", "-b", "feature");
    writeFiles(root, { "b.ts": "y;\nw;\n" });
    git(root, "commit", "-q", "-am", "feature");
    writeFiles(root, { "a.ts": "x;\nz;\n" });
    return served;
  }

  test("lists the branches, local and remote, without the current one", async () => {
    const { get } = await serveFeature();
    const branches = await get<BranchesResponse>("/api/branches");
    expect(branches).toEqual({
      status: 200,
      body: { local: ["main"], remote: ["origin/main"] },
    });
  });

  test("lists and diffs the changes since where HEAD left the branch", async () => {
    const { get } = await serveFeature();
    const changes = await get<ChangesResponse>("/api/changes?base=main");
    expect(changes.body.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(
      (await get<ChangesResponse>("/api/changes")).body.files.map(
        (f) => f.path,
      ),
    ).toEqual(["a.ts"]);

    const diff = await get<FileDiff>("/api/diff?path=b.ts&base=origin%2Fmain");
    expect(diff.status).toBe(200);
    expect(diff.body).toMatchObject({
      kind: "text",
      changes: [{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 1 }],
    });
    expect((await get("/api/diff?path=b.ts")).status).toBe(404);
  });

  test("returns 404 for a name that is not a listed branch", async () => {
    const { get } = await serveFeature();
    for (const name of ["nope", "feature", "--output=x", "HEAD~1"]) {
      const query = `base=${encodeURIComponent(name)}`;
      expect((await get(`/api/changes?${query}`)).status).toBe(404);
      expect((await get(`/api/diff?path=a.ts&${query}`)).status).toBe(404);
    }
  });

  test("returns 400 for a branch with no common ancestor", async () => {
    const { root, get } = await serveFeature();
    const tree = git(root, "rev-parse", "HEAD^{tree}").trim();
    const lonely = git(root, "commit-tree", tree, "-m", "lonely").trim();
    git(root, "update-ref", "refs/heads/lonely", lonely);
    const res = await get<{ error: string }>("/api/changes?base=lonely");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "No common ancestor with lonely." });
    expect((await get("/api/diff?path=a.ts&base=lonely")).status).toBe(400);
  });
});

describe("changes.changed", () => {
  test("is published when a file changes and when changes are committed", async () => {
    const { root, server, get } = await serve({ "a.md": "one\n" }, true);
    await expectEditAndCommit(root, server, get);
  }, 20_000);

  // Git's metadata is outside the root in these: a commit changes nothing in it.
  test("is published when changes are committed in a linked worktree", async () => {
    const repo = gitRepo({ "a.md": "one\n" });
    const tree = `${repo}-tree`;
    roots.push(repo, tree);
    git(repo, "worktree", "add", "-q", "-b", "tree", tree);
    const { server, get } = await start(tree, true);
    await expectEditAndCommit(tree, server, get);
  }, 20_000);

  test("is published when changes are committed in a directory of the repository", async () => {
    const repo = gitRepo({ "sub/a.md": "one\n" });
    roots.push(repo);
    const root = join(repo, "sub");
    const { server, get } = await start(root, true);
    await expectEditAndCommit(root, server, get);
  }, 20_000);
});

/** Edits a.md in `root` and then commits it, expecting changes.changed for each. */
async function expectEditAndCommit(
  root: string,
  server: AppServer,
  get: Awaited<ReturnType<typeof start>>["get"],
) {
  const events: ServerEvent[] = [];
  const ws = new WebSocket(
    `ws://127.0.0.1:${server.port}/ws?token=${TEST_TOKEN}`,
  );
  ws.onmessage = (m) => events.push(JSON.parse(String(m.data)) as ServerEvent);
  await new Promise((resolve) => (ws.onopen = resolve));
  await Bun.sleep(300); // let the watcher settle

  const waitForEvent = async () => {
    const deadline = Date.now() + 5000;
    while (!events.some((e) => e.type === "changes.changed")) {
      if (Date.now() > deadline) throw new Error("no changes.changed");
      await Bun.sleep(50);
    }
    events.length = 0;
  };

  writeFiles(root, { "a.md": "two\n" });
  await waitForEvent();
  expect((await get<ChangesResponse>("/api/changes")).body.files).toHaveLength(
    1,
  );

  git(root, "commit", "-q", "-am", "edit");
  await waitForEvent();
  expect((await get<ChangesResponse>("/api/changes")).body.files).toEqual([]);
  ws.close();
}
