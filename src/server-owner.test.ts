import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { gitRepo, TEST_TOKEN, testSession, writeFiles } from "../test/support";
import { FileIndex } from "./files/file-index";
import { type AppServer, type ServerOptions, startServer } from "./server";
import type {
  ErrorResponse,
  PromptResponse,
  SessionInfo,
  Thread,
} from "./shared/api";
import type { ClientMessage, ServerEvent } from "./shared/events";

const root = gitRepo({
  ".gitignore": "dist/\nnotes/\n.env\n",
  "a.md": "one\n",
});
writeFiles(root, {
  ".env": "SECRET=1\n",
  "dist/out.js": "x\n",
  "notes/todo.md": "# Todo\n",
  "notes/pic.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
});
const outside = gitRepo({ "secret.txt": "secret\n" });
symlinkSync(join(outside, "secret.txt"), join(root, "dist/secret.txt"));
const index = await FileIndex.create(root);
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const servers: AppServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop(true)));
});

function start(options: Partial<ServerOptions> = {}): AppServer {
  const server = startServer({
    root,
    host: "127.0.0.1",
    port: 0,
    strictPort: true,
    index,
    allowedHosts: [],
    maxHighlightBytes: 2_000_000,
    session: testSession(),
    ...options,
  });
  servers.push(server);
  return server;
}

/** Headers tailscale serve adds, making the request a participant's. */
const PROXIED = { "X-Forwarded-For": "100.64.0.2" };

const get = (server: AppServer, path: string, headers = {}) =>
  fetch(new URL(path, server.url), { headers });

const send = (
  server: AppServer,
  method: string,
  path: string,
  body: unknown,
  headers = {},
) =>
  fetch(new URL(path, server.url), {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Reviewbuddy-Token": TEST_TOKEN,
      ...headers,
    },
    body: JSON.stringify(body),
  });

const newThread = (path: string, line = 1) => ({
  path,
  startLine: line,
  endLine: line,
  originView: "source",
  body: "x",
  author: "Alice",
  clientId: "c-alice",
});

async function createThread(
  server: AppServer,
  path: string,
  line = 1,
): Promise<Thread> {
  const res = await send(server, "POST", "/api/threads", newThread(path, line));
  expect(res.status).toBe(201);
  return (await res.json()) as Thread;
}

async function session(
  server: AppServer,
  headers: Record<string, string> = {},
): Promise<SessionInfo> {
  const res = await fetch(new URL("/api/session", server.url), { headers });
  expect(res.status).toBe(200);
  return (await res.json()) as SessionInfo;
}

describe("GET /api/session", () => {
  test("a direct connection from this machine is the owner", async () => {
    expect((await session(start())).owner).toBe(true);
  });

  test("a request through tailscale serve is a participant", async () => {
    const server = start();
    expect(
      (await session(server, { "X-Forwarded-For": "100.64.0.2" })).owner,
    ).toBe(false);
    expect((await session(server, { Host: "mac.tail1.ts.net" })).owner).toBe(
      false,
    );
  });

  test("options.isOwner decides instead", async () => {
    expect((await session(start({ isOwner: () => false }))).owner).toBe(false);
  });
});

describe("GET /api/tree/ignored", () => {
  test("lists ignored files and folded directories for the owner", async () => {
    const server = start();
    const res = await get(server, "/api/tree/ignored");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paths: ["dist/", "notes/", ".env"] });
    const dir = await get(server, "/api/tree/ignored?dir=dist/");
    expect(await dir.json()).toEqual({
      paths: ["dist/out.js", "dist/secret.txt"],
    });
  });

  test.each([["missing/"], ["../"], ["dist"], [""]])(
    "404 for dir=%p",
    async (dir) => {
      const res = await get(start(), `/api/tree/ignored?dir=${dir}`);
      expect(res.status).toBe(404);
    },
  );

  test("403 for participants", async () => {
    for (const res of [
      await get(start(), "/api/tree/ignored", PROXIED),
      await get(start({ isOwner: () => false }), "/api/tree/ignored?dir=dist/"),
    ]) {
      expect(res.status).toBe(403);
      expect(((await res.json()) as ErrorResponse).error).toBe(
        "Only the owner can see ignored files.",
      );
    }
  });
});

describe("ignored files in GET /api/file and GET /api/raw", () => {
  test("the owner reads them", async () => {
    const server = start();
    const md = await get(server, "/api/file?path=notes/todo.md");
    expect(md.status).toBe(200);
    expect(await md.json()).toMatchObject({
      kind: "markdown",
      lines: ["# Todo"],
    });
    const env = await get(server, "/api/file?path=.env");
    expect(await env.json()).toMatchObject({ lines: ["SECRET=1"] });
    const svg = await get(server, "/api/raw?path=notes/pic.svg");
    expect(svg.status).toBe(200);
    expect(svg.headers.get("content-security-policy")).toContain("sandbox");
  });

  test("participants get 404, as for unlisted files", async () => {
    const server = start();
    for (const path of [
      "/api/file?path=notes/todo.md",
      "/api/file?path=.env",
      "/api/raw?path=notes/pic.svg",
    ]) {
      expect((await get(server, path, PROXIED)).status).toBe(404);
    }
  });

  test.each([
    ["dist/secret.txt"],
    ["../a.md"],
    ["dist/../.env"],
    ["notes"],
    [".git/config"],
  ])("even the owner gets 404 for %p", async (path) => {
    expect((await get(start(), `/api/file?path=${path}`)).status).toBe(404);
  });

  test("listed files still work for participants", async () => {
    const res = await get(start(), "/api/file?path=a.md", PROXIED);
    expect(res.status).toBe(200);
  });
});

describe("threads on ignored files", () => {
  test("only the owner creates them; others get 400 as for unknown files", async () => {
    const server = start();
    expect(await createThread(server, ".env")).toMatchObject({
      path: ".env",
      ignored: true,
    });
    expect(await createThread(server, "a.md")).toMatchObject({
      ignored: false,
    });
    for (const path of [".env", "missing.md"]) {
      const res = await send(
        server,
        "POST",
        "/api/threads",
        newThread(path),
        PROXIED,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: `Unknown file: ${path}` });
    }
  });

  test("participants see them but cannot change them", async () => {
    const server = start();
    const thread = await createThread(server, ".env");
    const listed = await createThread(server, "a.md");
    const first = thread.comments[0]!.id;
    const threads = (await (
      await get(server, "/api/threads", PROXIED)
    ).json()) as Thread[];
    expect(threads.map((t) => [t.id, t.ignored])).toEqual([
      [thread.id, true],
      [listed.id, false],
    ]);

    const writes: [string, string, unknown][] = [
      [
        "POST",
        `/api/threads/${thread.id}/comments`,
        { author: "Bob", clientId: "c-bob", body: "hi" },
      ],
      ["PATCH", `/api/comments/${first}`, { clientId: "c-alice", body: "y" }],
      ["DELETE", `/api/comments/${first}`, { clientId: "c-alice" }],
      ["POST", `/api/threads/${thread.id}/resolve`, { author: "Bob" }],
      ["POST", `/api/threads/${thread.id}/reopen`, {}],
    ];
    for (const [method, path, body] of writes) {
      const res = await send(server, method, path, body, PROXIED);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "Only the owner can change threads on ignored files.",
      });
    }
    const reply = await send(
      server,
      "POST",
      `/api/threads/${listed.id}/comments`,
      { author: "Bob", clientId: "c-bob", body: "hi" },
      PROXIED,
    );
    expect(reply.status).toBe(201);
  });

  test("the owner changes them", async () => {
    const server = start();
    const thread = await createThread(server, ".env");
    const first = thread.comments[0]!.id;
    const replied = await send(
      server,
      "POST",
      `/api/threads/${thread.id}/comments`,
      { author: "Alice", clientId: "c-alice", body: "more" },
    );
    expect(replied.status).toBe(201);
    const reply = ((await replied.json()) as Thread).comments[1]!.id;
    const writes: [string, string, unknown][] = [
      ["PATCH", `/api/comments/${first}`, { clientId: "c-alice", body: "y" }],
      ["POST", `/api/threads/${thread.id}/resolve`, { author: "Alice" }],
      ["POST", `/api/threads/${thread.id}/reopen`, {}],
      ["DELETE", `/api/comments/${reply}`, { clientId: "c-alice" }],
    ];
    for (const [method, path, body] of writes) {
      const res = await send(server, method, path, body);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Thread | { thread: Thread };
      expect("thread" in json ? json.thread : json).toMatchObject({
        ignored: true,
      });
    }
  });

  test("stay on their lines after a restart", async () => {
    writeFiles(root, { "notes/plan.md": "one\ntwo\n" });
    const session = testSession();
    const first = start({ session });
    await createThread(first, "notes/plan.md", 2);
    await first.stop(true);
    writeFiles(root, { "notes/plan.md": "zero\none\ntwo\n" });

    const threads = (await (
      await get(start({ session }), "/api/threads")
    ).json()) as Thread[];
    expect(threads).toEqual([
      expect.objectContaining({ startLine: 3, outdated: false, ignored: true }),
    ]);
  });
});

describe("POST /api/prompt", () => {
  test("only the owner copies prompts", async () => {
    const server = start();
    const thread = await createThread(server, ".env");
    const body = { threadIds: [thread.id], author: "Bob", resolve: true };
    const denied = await send(server, "POST", "/api/prompt", body, PROXIED);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: "Only the owner can copy prompts.",
    });
    const [after] = (await (
      await get(server, "/api/threads")
    ).json()) as Thread[];
    expect(after).toMatchObject({ exportedAt: null, status: "open" });

    const res = await send(server, "POST", "/api/prompt", body);
    expect(res.status).toBe(200);
    const prompt = (await res.json()) as PromptResponse;
    expect(prompt.text).toContain(".env");
    expect(prompt.threads).toEqual([
      expect.objectContaining({ status: "resolved", ignored: true }),
    ]);
  });
});

describe("watching ignored files", () => {
  type Client = {
    events: ServerEvent[];
    send(message: ClientMessage): void;
    close(): void;
  };
  const connect = (server: AppServer, headers = {}) =>
    new Promise<Client>((resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${server.port}/ws?token=${TEST_TOKEN}`,
        { headers } as unknown as string[],
      );
      const events: ServerEvent[] = [];
      ws.onmessage = (m) =>
        events.push(JSON.parse(String(m.data)) as ServerEvent);
      ws.onopen = () =>
        resolve({
          events,
          send: (message) => ws.send(JSON.stringify(message)),
          close: () => ws.close(),
        });
      ws.onerror = () => reject(new Error("rejected"));
    });
  const until = async (done: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!done() && Date.now() < deadline) await Bun.sleep(50);
  };
  const changed = (events: ServerEvent[]) =>
    events.flatMap((e) => (e.type === "file.changed" ? [e.path] : []));

  test("edits reach only the owner, for open files and files with threads", async () => {
    const repo = gitRepo({ ".gitignore": "secret/\n.env\n", "a.md": "a\n" });
    writeFiles(repo, {
      ".env": "A=1\n",
      "secret/plan.md": "one\ntwo\n",
      "secret/other.txt": "x\n",
    });
    try {
      const server = start({
        root: repo,
        index: await FileIndex.create(repo),
        watch: true,
      });
      await createThread(server, "secret/plan.md", 2);
      const owner = await connect(server);
      const participant = await connect(server, PROXIED);
      owner.send({ type: "hello", nickname: "Alice", clientId: "c-alice" });
      owner.send({ type: "view", path: ".env" });
      // Participants never see which ignored file the owner has open.
      await until(() =>
        participant.events.some(
          (e) =>
            e.type === "presence.changed" &&
            e.participants.some((p) => p.nickname === "Alice"),
        ),
      );
      const presence = participant.events.findLast(
        (e) => e.type === "presence.changed",
      );
      expect(presence).toMatchObject({
        participants: [{ nickname: "Alice", path: null }],
      });
      await Bun.sleep(300); // let the watcher settle

      writeFiles(repo, {
        "secret/plan.md": "zero\none\ntwo\n",
        ".env": "A=2\n",
        "secret/other.txt": "y\n",
      });
      const moved = (e: ServerEvent) =>
        e.type === "thread.updated" && e.thread.startLine === 3;
      await until(
        () =>
          changed(owner.events).includes(".env") &&
          changed(owner.events).includes("secret/plan.md") &&
          participant.events.some(moved),
      );
      await Bun.sleep(300);
      owner.close();
      participant.close();

      expect(changed(owner.events).sort()).toEqual([".env", "secret/plan.md"]);
      expect(changed(participant.events)).toEqual([]);
      expect(participant.events.find(moved)).toMatchObject({
        thread: { outdated: false, ignored: true },
      });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
