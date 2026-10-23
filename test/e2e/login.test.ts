import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccessGate } from "../../src/auth";
import { FileIndex } from "../../src/files/file-index";
import { type AppServer, startServer } from "../../src/server";
import { testSession, webView } from "../support";

const root = realpathSync(
  mkdtempSync(join(tmpdir(), "reviewbuddy-login-e2e-")),
);
writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
const session = testSession();
let server: AppServer;

// In development mode Bun's hot reloading reloads the page when the server
// restarts, racing the test; the compiled binary runs in production mode.
async function start(pin: string, port = 0): Promise<AppServer> {
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    return startServer({
      root,
      host: "127.0.0.1",
      port,
      strictPort: true,
      index: await FileIndex.create(root),
      allowedHosts: [],
      maxHighlightBytes: 2_000_000,
      session,
      access: new AccessGate(pin),
    });
  } finally {
    process.env.NODE_ENV = nodeEnv;
  }
}

beforeAll(async () => {
  server = await start("482913");
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

const dialogShown = `!!document.querySelector('[data-dialog="login"]')`;
const treeShown = `!!document.querySelector(".app-sidebar li")`;

async function enterPin(view: Bun.WebView, pin: string): Promise<void> {
  await view.click('[data-dialog="login"] input[name="pin"]');
  await view.evaluate(
    `document.querySelector('[data-dialog="login"] input[name="pin"]').select()`,
  );
  await view.type(pin);
  await view.click('[data-dialog="login"] button[type="submit"]');
}

test("the PIN is asked once per browser and again after a restart", async () => {
  await using view = webView({ width: 1000, height: 700 });
  const origin = `http://127.0.0.1:${server.port}`;
  await view.navigate(`${origin}/api/health`);
  await view.evaluate("localStorage.clear()");
  await view.navigate(`${origin}/#/doc/a.ts`);

  // Nothing is loaded before the PIN.
  await waitFor(view, dialogShown);
  expect(await view.evaluate(treeShown)).toBe(false);

  await view.click('[data-dialog="login"] input[name="nickname"]');
  await view.type("Alice");
  await enterPin(view, "000 000");
  await waitFor(
    view,
    `document.querySelector('[data-dialog="login"] .dialog-error')?.textContent === "Wrong PIN."`,
  );

  await enterPin(view, "482 913");
  await waitFor(view, `!(${dialogShown})`);
  await waitFor(view, treeShown);
  await waitFor(view, `!!document.querySelector(".code.commentable")`);
  expect(
    await view.evaluate(`document.querySelector(".app-me").textContent`),
  ).toBe("Alice (you)");

  // The cookie keeps working for this server (Chrome does not reload on a
  // navigation to the same URL, so go through another page).
  await view.navigate(`${origin}/api/health`);
  await view.navigate(`${origin}/#/doc/a.ts`);
  await waitFor(view, treeShown);
  expect(await view.evaluate(dialogShown)).toBe(false);

  // A restart forgets every cookie and has a new PIN.
  const port = server.port!;
  await server.stop(true);
  server = await start("135790", port);
  await waitFor(view, dialogShown);
  expect(
    await view.evaluate(
      `document.querySelector('[data-dialog="login"] input[name="nickname"]').value`,
    ),
  ).toBe("Alice");
  await enterPin(view, "135790");
  await waitFor(view, `!(${dialogShown})`);
  await waitFor(view, `!!document.querySelector(".code.commentable")`);
}, 60_000);
