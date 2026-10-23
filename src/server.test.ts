import { afterEach, describe, expect, test } from "bun:test";
import { startServer } from "./server";
import { VERSION } from "./version";

const servers: Bun.Server<undefined>[] = [];
function start(port: number, strictPort: boolean) {
  const server = startServer({
    root: "/tmp/project",
    host: "127.0.0.1",
    port,
    strictPort,
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop(true)));
});

describe("startServer", () => {
  test("GET /api/health reports the app and root", async () => {
    const server = start(0, true);
    const res = await fetch(new URL("/api/health", server.url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "akapen",
      version: VERSION,
      root: "/tmp/project",
    });
  });

  test("GET / serves the SPA shell", async () => {
    const server = start(0, true);
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).toMatch(/<script[^>]+src="[^"]+\.js"/);
  });

  test("unknown paths are 404", async () => {
    const server = start(0, true);
    const res = await fetch(new URL("/nope", server.url));
    expect(res.status).toBe(404);
  });

  test("moves to the next port when the default one is busy", () => {
    const busy = start(0, true);
    const server = start(busy.port!, false);
    expect(server.port).toBeGreaterThan(busy.port!);
  });

  test("fails when an explicit port is busy", () => {
    const busy = start(0, true);
    expect(() => start(busy.port!, true)).toThrow();
  });
});
