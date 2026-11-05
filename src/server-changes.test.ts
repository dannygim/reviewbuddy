import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
  git,
  gitRepo,
  TEST_TOKEN,
  testSession,
  writeFiles,
} from "../test/support";
import { FileIndex } from "./files/file-index";
import { type AppServer, startServer } from "./server";
import type { ChangesResponse, FileDiff } from "./shared/api";
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
  return { root, server, get };
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

describe("changes.changed", () => {
  test("is published when a file changes and when changes are committed", async () => {
    const { root, server, get } = await serve({ "a.md": "one\n" }, true);
    const events: ServerEvent[] = [];
    const ws = new WebSocket(
      `ws://127.0.0.1:${server.port}/ws?token=${TEST_TOKEN}`,
    );
    ws.onmessage = (m) =>
      events.push(JSON.parse(String(m.data)) as ServerEvent);
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
    expect(
      (await get<ChangesResponse>("/api/changes")).body.files,
    ).toHaveLength(1);

    git(root, "commit", "-q", "-am", "edit");
    await waitForEvent();
    expect((await get<ChangesResponse>("/api/changes")).body.files).toEqual([]);
    ws.close();
  }, 20_000);
});
