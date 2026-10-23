import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileIndex } from "./files/file-index";
import { startServer } from "./server";
import { VERSION } from "./version";

const root = realpathSync(mkdtempSync(join(tmpdir(), "akapen-server-")));
writeFileSync(join(root, "a.ts"), "const a = 1;\n");
writeFileSync(join(root, "README.md"), "# Hi\n");
writeFileSync(
  join(root, "logo.svg"),
  "<svg xmlns='http://www.w3.org/2000/svg'/>",
);
writeFileSync(join(root, "x.dat"), new Uint8Array([1, 0, 2]));
const index = await FileIndex.create(root);

afterAll(() => rmSync(root, { recursive: true, force: true }));

const servers: Bun.Server<undefined>[] = [];
function start(port: number, strictPort: boolean) {
  const server = startServer({
    root,
    host: "127.0.0.1",
    port,
    strictPort,
    index,
    allowedHosts: [],
    maxHighlightBytes: 2_000_000,
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop(true)));
});

async function get(path: string, headers: Record<string, string> = {}) {
  const server = start(0, true);
  return fetch(new URL(path, server.url), { headers });
}

describe("startServer", () => {
  test("GET /api/health reports the app and root", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "akapen",
      version: VERSION,
      root,
    });
  });

  test("GET / serves the SPA shell", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('<div id="root"></div>');
    expect(html).toMatch(/<script[^>]+src="[^"]+\.js"/);
  });

  test("unknown paths are 404", async () => {
    expect((await get("/nope")).status).toBe(404);
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

describe("file API", () => {
  test("GET /api/tree lists files in tree order", async () => {
    const res = await get("/api/tree");
    expect(await res.json()).toEqual({
      files: ["a.ts", "logo.svg", "README.md", "x.dat"],
    });
  });

  test("GET /api/file returns a highlighted view", async () => {
    const res = await get("/api/file?path=a.ts");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      kind: "code",
      path: "a.ts",
      lang: "typescript",
      lines: ["const a = 1;"],
    });
  });

  test("GET /api/file reports binary files", async () => {
    const res = await get("/api/file?path=x.dat");
    expect(await res.json()).toMatchObject({ kind: "binary", path: "x.dat" });
  });

  test.each([["missing.ts"], ["../etc/passwd"], [""]])(
    "GET /api/file?path=%p is 404",
    async (path) => {
      const res = await get(`/api/file?path=${encodeURIComponent(path)}`);
      expect(res.status).toBe(404);
    },
  );

  test("GET /api/raw serves images in a sandbox", async () => {
    const res = await get("/api/raw?path=logo.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("GET /api/raw does not serve non-images", async () => {
    expect((await get("/api/raw?path=a.ts")).status).toBe(404);
  });

  test("rejects requests for hosts that are not allowed", async () => {
    const res = await get("/api/tree", { Host: "evil.example" });
    expect(res.status).toBe(403);
  });
});
