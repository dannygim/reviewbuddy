import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileIndex } from "../../src/files/file-index";
import { type AppServer, startServer } from "../../src/server";
import { testSession, webView } from "../support";

const root = realpathSync(mkdtempSync(join(tmpdir(), "reviewbuddy-end-e2e-")));
writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
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

async function waitFor(view: Bun.WebView, expression: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await view.evaluate(expression)) return;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

// Separate origins keep the two participants' storage apart on Chrome.
async function joinAs(name: string, host: string): Promise<Bun.WebView> {
  const view = webView({ width: 1100, height: 800 });
  const origin = `http://${host}:${server.port}`;
  await view.navigate(`${origin}/api/health`);
  await view.evaluate("localStorage.clear()");
  await view.navigate(`${origin}/#/doc/a.ts`);
  await view.click(".dialog input");
  await view.type(name);
  await view.click('.dialog button[type="submit"]');
  await waitFor(view, `!document.querySelector(".dialog")`);
  await waitFor(view, `!!document.querySelector(".code.commentable")`);
  return view;
}

test("ending the session makes every view read-only", async () => {
  await using alice = await joinAs("Alice", "127.0.0.1");
  await using bob = await joinAs("Bob", "localhost");

  await alice.click('[data-action="end-session"]');
  await alice.click('[data-action="confirm-end"]');

  for (const view of [alice, bob]) {
    await waitFor(
      view,
      `document.querySelector(".banner")?.textContent.includes("has ended")`,
    );
    await waitFor(view, `!document.querySelector(".code.commentable")`);
    expect(
      await view.evaluate(
        `!!document.querySelector('[data-action="end-session"]')`,
      ),
    ).toBe(false);
  }
}, 60_000);
