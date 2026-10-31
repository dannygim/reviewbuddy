import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileIndex } from "../../src/files/file-index";
import { type AppServer, startServer } from "../../src/server";
import { testSession, webView } from "../support";

function makeRoot(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "reviewbuddy-e2e-")));
  for (const [path, body] of Object.entries(files)) {
    writeFileSync(join(root, path), body);
  }
  return root;
}

const withReadme = makeRoot({ "README.md": "# Root\n", "other.md": "# O\n" });
const withoutReadme = makeRoot({ "other.md": "# O\n" });

let servers: AppServer[] = [];

async function start(root: string): Promise<AppServer> {
  return startServer({
    root,
    host: "127.0.0.1",
    port: 0,
    strictPort: true,
    index: await FileIndex.create(root),
    allowedHosts: [],
    maxHighlightBytes: 2_000_000,
    session: testSession({ readOnly: true }),
  });
}

beforeAll(async () => {
  servers = [await start(withReadme), await start(withoutReadme)];
});

afterAll(async () => {
  for (const server of servers) await server.stop(true);
  for (const root of [withReadme, withoutReadme]) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function waitFor(view: Bun.WebView, expression: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await view.evaluate(expression)) return;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

test("opens the root README.md when no file is open", async () => {
  await using view = webView({ width: 1000, height: 700 });
  await view.navigate(servers[0]!.url.href);

  await waitFor(view, `location.hash === "#/doc/README.md"`);
  await waitFor(
    view,
    `document.querySelector(".markdown h1")?.textContent === "Root"`,
  );
  expect(
    await view.evaluate(
      `document.querySelector('[data-path="README.md"]').getAttribute("aria-current")`,
    ),
  ).toBe("page");
  // Replaced, not pushed: Back leaves reviewbuddy instead of bouncing back.
  // Backends start with different histories, so compare with a page that
  // opens no file.
  await using plain = webView({ width: 1000, height: 700 });
  await plain.navigate(servers[1]!.url.href);
  await waitFor(plain, `!!document.querySelector(".viewer-note")`);
  expect(await view.evaluate(`history.length`)).toBe(
    await plain.evaluate(`history.length`),
  );
}, 30_000);

test("keeps a linked file instead of the root README.md", async () => {
  await using view = webView({ width: 1000, height: 700 });
  await view.navigate(`${servers[0]!.url.href}#/doc/other.md`);
  await waitFor(
    view,
    `document.querySelector(".markdown h1")?.textContent === "O"`,
  );
  expect(await view.evaluate(`location.hash`)).toBe("#/doc/other.md");
}, 30_000);

test("asks to select a file when the root has no README.md", async () => {
  await using view = webView({ width: 1000, height: 700 });
  await view.navigate(servers[1]!.url.href);
  await waitFor(
    view,
    `document.querySelector(".viewer-note")?.textContent === "Select a file to start reviewing."`,
  );
  expect(await view.evaluate(`location.hash`)).toBe("");
}, 30_000);
