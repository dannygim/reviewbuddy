import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_TOKEN, testSession } from "../test/support";
import { FileIndex } from "./files/file-index";
import { type AppServer, type SessionContext, startServer } from "./server";
import type { ServerEvent } from "./shared/events";

const root = realpathSync(mkdtempSync(join(tmpdir(), "akapen-end-")));
writeFileSync(join(root, "a.md"), "one\n");
const index = await FileIndex.create(root);
const servers: AppServer[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => s.stop(true)));
  rmSync(root, { recursive: true, force: true });
});

function start(session: SessionContext): AppServer {
  const server = startServer({
    root,
    host: "127.0.0.1",
    port: 0,
    strictPort: true,
    index,
    allowedHosts: [],
    maxHighlightBytes: 2_000_000,
    session,
    sessionPollMs: 50,
  });
  servers.push(server);
  return server;
}

function post(server: AppServer, path: string, body: unknown) {
  return fetch(new URL(path, server.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Akapen-Token": TEST_TOKEN,
    },
    body: JSON.stringify(body),
  });
}

function nextEvent(
  server: AppServer,
  type: ServerEvent["type"],
): Promise<ServerEvent> {
  const ws = new WebSocket(
    `ws://127.0.0.1:${server.port}/ws?token=${TEST_TOKEN}`,
  );
  return new Promise((resolve) => {
    ws.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as ServerEvent;
      if (event.type === type) {
        ws.close();
        resolve(event);
      }
    };
  });
}

const comment = {
  path: "a.md",
  startLine: 1,
  endLine: 1,
  originView: "source",
  body: "x",
  author: "Alice",
  clientId: "c",
};

test("POST /api/session/end makes the session read-only for everyone", async () => {
  const session = testSession();
  const server = start(session);
  const ended = nextEvent(server, "session.ended");
  await Bun.sleep(50);

  const res = await post(server, "/api/session/end", {});
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ended", readOnly: true });
  expect(session.meta.status).toBe("ended");
  await ended;

  expect((await post(server, "/api/threads", comment)).status).toBe(409);
  const info = await (await fetch(new URL("/api/session", server.url))).json();
  expect(info).toMatchObject({ status: "ended", readOnly: true });
});

test("notices a session ended outside the server (akapen session end)", async () => {
  const session = testSession();
  const server = start(session);
  const ended = nextEvent(server, "session.ended");
  await Bun.sleep(50);

  session.reload = () => ({
    ...session.meta,
    status: "ended",
    endedAt: "2026-10-23T17:00:00+09:00",
  });
  await ended;
  expect((await post(server, "/api/threads", comment)).status).toBe(409);
});
