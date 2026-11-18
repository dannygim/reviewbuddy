import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testSession } from "../test/support";
import { FileIndex } from "./files/file-index";
import { type AppServer, type ServerOptions, startServer } from "./server";
import type { SessionInfo } from "./shared/api";

const root = realpathSync(mkdtempSync(join(tmpdir(), "reviewbuddy-owner-")));
writeFileSync(join(root, "a.md"), "one\n");
const index = await FileIndex.create(root);
afterAll(() => rmSync(root, { recursive: true, force: true }));

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
