import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_TOKEN, testSession } from "../../test/support";
import { FileIndex } from "../files/file-index";
import { type AppServer, startServer } from "../server";
import type { ClientMessage, ServerEvent } from "../shared/events";

const root = realpathSync(mkdtempSync(join(tmpdir(), "akapen-hub-")));
writeFileSync(join(root, "a.md"), "one\ntwo\n");
let server: AppServer;

beforeAll(async () => {
  server = startServer({
    root,
    host: "127.0.0.1",
    port: 0,
    strictPort: true,
    index: await FileIndex.create(root),
    allowedHosts: [],
    maxHighlightBytes: 2_000_000,
    session: testSession(),
  });
});
afterAll(async () => {
  await server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

type Client = {
  ws: WebSocket;
  events: ServerEvent[];
  send(message: ClientMessage): void;
  waitFor(match: (event: ServerEvent) => boolean): Promise<ServerEvent>;
};

function wsUrl(token = TEST_TOKEN) {
  return `ws://127.0.0.1:${server.port}/ws?token=${token}`;
}

function connect(): Promise<Client> {
  const ws = new WebSocket(wsUrl());
  const events: ServerEvent[] = [];
  const waiters: (() => void)[] = [];
  ws.onmessage = (message) => {
    events.push(JSON.parse(String(message.data)) as ServerEvent);
    for (const wake of waiters.splice(0)) wake();
  };
  const client: Client = {
    ws,
    events,
    send: (m) => ws.send(JSON.stringify(m)),
    async waitFor(match) {
      for (;;) {
        const found = events.find(match);
        if (found) return found;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
  };
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve(client);
    ws.onerror = () => reject(new Error("rejected"));
  });
}

/** Resolves "opened" or "rejected" for an upgrade attempt. */
function attempt(url: string, headers: Record<string, string> = {}) {
  return new Promise<string>((resolve) => {
    const ws = new WebSocket(url, { headers } as unknown as string[]);
    ws.onopen = () => {
      ws.close();
      resolve("opened");
    };
    ws.onerror = () => resolve("rejected");
  });
}

const participants = (event: ServerEvent) =>
  event.type === "presence.changed" ? event.participants : [];

async function postThread(body: string) {
  const res = await fetch(new URL("/api/threads", server.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Akapen-Token": TEST_TOKEN,
    },
    body: JSON.stringify({
      path: "a.md",
      startLine: 1,
      endLine: 1,
      originView: "source",
      body,
      author: "Alice",
      clientId: "c-alice",
    }),
  });
  expect(res.status).toBe(201);
}

describe("WebSocket hub", () => {
  test("shares presence and removes people who leave", async () => {
    const a = await connect();
    const b = await connect();
    a.send({ type: "hello", nickname: "Alice", clientId: "c-a" });
    b.send({ type: "hello", nickname: "Bob", clientId: "c-b" });
    b.send({ type: "view", path: "a.md" });
    const both = await a.waitFor((e) =>
      participants(e).some((p) => p.nickname === "Bob" && p.path === "a.md"),
    );
    expect(
      participants(both)
        .map((p) => p.nickname)
        .sort(),
    ).toEqual(["Alice", "Bob"]);

    b.ws.close();
    await a.waitFor(
      (e) => e.type === "presence.changed" && participants(e).length === 1,
    );
    a.ws.close();
  });

  test("delivers thread events from REST writes to every client", async () => {
    const clients = await Promise.all(Array.from({ length: 10 }, connect));
    await postThread("For everyone");
    await Promise.all(
      clients.map((c) =>
        c.waitFor(
          (e) =>
            e.type === "thread.created" &&
            e.thread.comments[0]?.body === "For everyone",
        ),
      ),
    );
    for (const c of clients) c.ws.close();
  });

  test("rejects a missing or wrong token", async () => {
    expect(await attempt(wsUrl(""))).toBe("rejected");
    expect(await attempt(wsUrl("nope"))).toBe("rejected");
    expect(await attempt(wsUrl())).toBe("opened");
  });

  test("rejects other sites and hosts", async () => {
    expect(await attempt(wsUrl(), { Origin: "http://evil.example" })).toBe(
      "rejected",
    );
    expect(await attempt(wsUrl(), { Host: "evil.example" })).toBe("rejected");
    expect(
      await attempt(wsUrl(), { Origin: `http://127.0.0.1:${server.port}` }),
    ).toBe("opened");
    expect(await attempt(wsUrl(), { Origin: "https://mac.tail1.ts.net" })).toBe(
      "opened",
    );
  });
});
