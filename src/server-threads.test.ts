import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_TOKEN, testSession } from "../test/support";
import { FileIndex } from "./files/file-index";
import { type SessionContext, startServer } from "./server";
import type { Thread } from "./shared/api";

const root = realpathSync(mkdtempSync(join(tmpdir(), "akapen-threads-")));
writeFileSync(join(root, "a.md"), "# A\n\none\ntwo\n");
writeFileSync(join(root, "logo.png"), new Uint8Array([137, 80, 78, 71]));
const index = await FileIndex.create(root);

const servers: Bun.Server<undefined>[] = [];
function start(session: SessionContext) {
  const server = startServer({
    root,
    host: "127.0.0.1",
    port: 0,
    strictPort: true,
    index,
    allowedHosts: [],
    maxHighlightBytes: 2_000_000,
    session,
  });
  servers.push(server);
  return server;
}

let server: Bun.Server<undefined>;
beforeAll(() => {
  server = start(testSession());
});
afterAll(async () => {
  await Promise.all(servers.map((s) => s.stop(true)));
  rmSync(root, { recursive: true, force: true });
});

const alice = { author: "Alice", clientId: "c-alice" };
const bob = { author: "Bob", clientId: "c-bob" };

function send(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  target = server,
) {
  return fetch(new URL(path, target.url), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Akapen-Token": TEST_TOKEN,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createThread(lines: [number, number] = [3, 4]): Promise<Thread> {
  const res = await send("POST", "/api/threads", {
    path: "a.md",
    startLine: lines[0],
    endLine: lines[1],
    originView: "source",
    body: "Please fix",
    ...alice,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Thread;
}

describe("session API", () => {
  test("GET /api/session returns the session and its token", async () => {
    const res = await fetch(new URL("/api/session", server.url));
    expect(await res.json()).toMatchObject({
      id: "20261023-1530-test-0000",
      status: "active",
      readOnly: false,
      token: TEST_TOKEN,
    });
  });

  test("GET /api/health includes the session id", async () => {
    const res = await fetch(new URL("/api/health", server.url));
    expect(await res.json()).toMatchObject({
      sessionId: "20261023-1530-test-0000",
    });
  });
});

describe("thread API", () => {
  test("creates a thread anchored to the source lines", async () => {
    const thread = await createThread();
    expect(thread).toMatchObject({
      path: "a.md",
      startLine: 3,
      endLine: 4,
      anchorText: "one\ntwo",
      status: "open",
      comments: [{ body: "Please fix", author: "Alice" }],
    });
    const listed = (await (
      await fetch(new URL("/api/threads?path=a.md", server.url))
    ).json()) as Thread[];
    expect(listed.map((t) => t.id)).toContain(thread.id);
  });

  test("adds, edits and deletes replies", async () => {
    const thread = await createThread();
    let res = await send("POST", `/api/threads/${thread.id}/comments`, {
      ...bob,
      body: "Agreed",
    });
    expect(res.status).toBe(201);
    const reply = ((await res.json()) as Thread).comments[1]!;

    res = await send("PATCH", `/api/comments/${reply.id}`, {
      clientId: "c-alice",
      body: "x",
    });
    expect(res.status).toBe(403);
    res = await send("PATCH", `/api/comments/${reply.id}`, {
      clientId: "c-bob",
      body: "Agreed!",
    });
    expect(((await res.json()) as Thread).comments[1]!.body).toBe("Agreed!");

    res = await send("DELETE", `/api/comments/${thread.comments[0]!.id}`, {
      clientId: "c-alice",
    });
    expect(res.status).toBe(409);
    res = await send("DELETE", `/api/comments/${reply.id}`, {
      clientId: "c-bob",
    });
    expect(await res.json()).toMatchObject({ thread: { id: thread.id } });
  });

  test("resolves and reopens", async () => {
    const thread = await createThread();
    let res = await send("POST", `/api/threads/${thread.id}/resolve`, {
      author: "Bob",
    });
    expect(await res.json()).toMatchObject({
      status: "resolved",
      resolvedBy: "Bob",
    });
    res = await send("POST", `/api/threads/${thread.id}/reopen`, {});
    expect(await res.json()).toMatchObject({ status: "open" });
  });

  test.each([
    [{ path: "missing.md" }, "Unknown file"],
    [{ path: "logo.png" }, "Cannot comment"],
    [{ startLine: 0 }, "out of range"],
    [{ endLine: 99 }, "out of range"],
    [{ body: "" }, "body must be"],
    [{ author: "x".repeat(51) }, "author must be"],
    [{ originView: "other" }, "originView must be"],
  ])("rejects invalid input %p", async (override, message) => {
    const res = await send("POST", "/api/threads", {
      path: "a.md",
      startLine: 1,
      endLine: 1,
      originView: "source",
      body: "x",
      ...alice,
      ...override,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(message);
  });

  test("returns 404 for unknown threads and comments", async () => {
    expect(
      (await send("POST", "/api/threads/nope/comments", { ...bob, body: "x" }))
        .status,
    ).toBe(404);
    expect(
      (await send("PATCH", "/api/comments/nope", { clientId: "c", body: "x" }))
        .status,
    ).toBe(404);
  });
});

describe("write protection", () => {
  test("requires the session token", async () => {
    const res = await send(
      "POST",
      "/api/threads",
      {},
      { "X-Akapen-Token": "" },
    );
    expect(res.status).toBe(403);
  });

  test("requires JSON", async () => {
    const res = await send("POST", "/api/threads", undefined, {
      "Content-Type": "text/plain",
    });
    expect(res.status).toBe(415);
  });

  test("rejects hosts that are not allowed", async () => {
    const res = await send(
      "POST",
      "/api/threads",
      {},
      { Host: "evil.example" },
    );
    expect(res.status).toBe(403);
  });

  test("refuses writes to an ended session", async () => {
    const readOnly = start(testSession({ readOnly: true }));
    const res = await send(
      "POST",
      "/api/threads",
      {
        path: "a.md",
        startLine: 1,
        endLine: 1,
        originView: "source",
        body: "x",
        ...alice,
      },
      {},
      readOnly,
    );
    expect(res.status).toBe(409);
  });
});
