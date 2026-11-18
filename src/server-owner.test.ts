import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { gitRepo, testSession, writeFiles } from "../test/support";
import { FileIndex } from "./files/file-index";
import { type AppServer, type ServerOptions, startServer } from "./server";
import type { ErrorResponse, SessionInfo } from "./shared/api";

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
