import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_TOKEN, testSession } from "../test/support";
import { FileIndex } from "./files/file-index";
import { type AppServer, startServer } from "./server";
import type { ServerEvent } from "./shared/events";

const root = realpathSync(mkdtempSync(join(tmpdir(), "akapen-server-watch-")));
writeFileSync(join(root, "a.md"), "one\ntwo\nthree\n");
let server: AppServer;
afterAll(async () => {
  await server?.stop(true);
  rmSync(root, { recursive: true, force: true });
});

test("a file edit moves its threads and tells the browsers", async () => {
  server = startServer({
    root,
    host: "127.0.0.1",
    port: 0,
    strictPort: true,
    index: await FileIndex.create(root),
    allowedHosts: [],
    maxHighlightBytes: 2_000_000,
    session: testSession(),
    watch: true,
  });
  const res = await fetch(new URL("/api/threads", server.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Akapen-Token": TEST_TOKEN,
    },
    body: JSON.stringify({
      path: "a.md",
      startLine: 2,
      endLine: 2,
      originView: "source",
      body: "on two",
      author: "Alice",
      clientId: "c",
    }),
  });
  expect(res.status).toBe(201);

  const events: ServerEvent[] = [];
  const ws = new WebSocket(
    `ws://127.0.0.1:${server.port}/ws?token=${TEST_TOKEN}`,
  );
  ws.onmessage = (m) => events.push(JSON.parse(String(m.data)) as ServerEvent);
  await new Promise((resolve) => (ws.onopen = resolve));
  await Bun.sleep(300); // let the watcher settle

  writeFileSync(join(root, "a.md"), "zero\none\ntwo\nthree\n");
  const deadline = Date.now() + 5000;
  while (
    !events.some(
      (e) => e.type === "thread.updated" && e.thread.startLine === 3,
    ) &&
    Date.now() < deadline
  ) {
    await Bun.sleep(50);
  }
  ws.close();
  expect(
    events.some((e) => e.type === "file.changed" && e.path === "a.md"),
  ).toBe(true);
  expect(
    events.find((e) => e.type === "thread.updated")?.type ===
      "thread.updated" &&
      events.some(
        (e) =>
          e.type === "thread.updated" &&
          e.thread.startLine === 3 &&
          !e.thread.outdated,
      ),
  ).toBe(true);
});
