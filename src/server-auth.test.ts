import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_TOKEN, testSession } from "../test/support";
import { AccessGate } from "./auth";
import { FileIndex } from "./files/file-index";
import { type AppServer, startServer } from "./server";

const root = realpathSync(mkdtempSync(join(tmpdir(), "reviewbuddy-auth-")));
writeFileSync(join(root, "a.md"), "# A\n");
writeFileSync(
  join(root, "logo.svg"),
  "<svg xmlns='http://www.w3.org/2000/svg'/>",
);
const server: AppServer = startServer({
  root,
  host: "127.0.0.1",
  port: 0,
  strictPort: true,
  index: await FileIndex.create(root),
  allowedHosts: [],
  maxHighlightBytes: 2_000_000,
  session: testSession(),
  access: new AccessGate("482913"),
});
afterAll(async () => {
  await server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

const url = (path: string) => new URL(path, server.url);
const login = (pin: unknown, headers: Record<string, string> = {}) =>
  fetch(url("/api/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ pin }),
  });

async function cookie(): Promise<string> {
  const res = await login("482 913");
  expect(res.status).toBe(204);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function ws(headers: Record<string, string>) {
  return new Promise<string>((resolve) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/ws?token=${TEST_TOKEN}`,
      {
        headers,
      } as unknown as string[],
    );
    socket.onopen = () => {
      socket.close();
      resolve("opened");
    };
    socket.onerror = () => resolve("rejected");
  });
}

describe("without the PIN", () => {
  test.each([
    ["/api/tree"],
    ["/api/session"],
    ["/api/file?path=a.md"],
    ["/api/raw?path=logo.svg"],
    ["/api/threads"],
  ])("GET %s is 401", async (path) => {
    const res = await fetch(url(path));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Enter the PIN shown where reviewbuddy was started.",
    });
  });

  test("writes are 401 even with the write token", async () => {
    const res = await fetch(url("/api/threads"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Reviewbuddy-Token": TEST_TOKEN,
      },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  test("the app shell and the health check stay open, without the root path", async () => {
    expect((await fetch(url("/"))).status).toBe(200);
    const health = await (await fetch(url("/api/health"))).json();
    expect(health).toEqual({
      name: "reviewbuddy",
      version: expect.any(String),
      sessionId: testSession().meta.id,
    });
  });

  test("the WebSocket is refused", async () => {
    expect(await ws({})).toBe("rejected");
  });
});

describe("logging in", () => {
  test("a wrong or malformed PIN is refused", async () => {
    expect((await login("000000")).status).toBe(401);
    expect((await login("12")).status).toBe(400);
    expect(
      (await fetch(url("/api/login"), { method: "POST", body: "{}" })).status,
    ).toBe(415);
  });

  test("the right PIN sets an HttpOnly cookie that opens everything", async () => {
    const res = await login("482913");
    expect(res.headers.get("set-cookie")).toMatch(
      new RegExp(
        `^reviewbuddy_auth_${server.port}=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=/$`,
      ),
    );
    const auth = await cookie();
    expect(
      (await fetch(url("/api/tree"), { headers: { Cookie: auth } })).status,
    ).toBe(200);
    expect(
      (await fetch(url("/api/session"), { headers: { Cookie: auth } })).status,
    ).toBe(200);
    expect(await ws({ Cookie: auth })).toBe("opened");
  });
});
