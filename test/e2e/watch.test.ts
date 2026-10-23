import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileIndex } from "../../src/files/file-index";
import { type AppServer, startServer } from "../../src/server";
import { testSession, webView } from "../support";

const root = realpathSync(mkdtempSync(join(tmpdir(), "akapen-watch-e2e-")));
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
    session: testSession({ readOnly: true }),
    watch: true,
  });
  await Bun.sleep(300); // let the watcher settle
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

test("shows changed and added files without a reload", async () => {
  await using view = webView({ width: 1000, height: 700 });
  await view.navigate(new URL("/#/doc/a.ts", server.url).href);
  await waitFor(
    view,
    `document.querySelector(".code-src")?.textContent === "export const a = 1;"`,
  );
  await view.evaluate("window.notReloaded = true");

  writeFileSync(
    join(root, "a.ts"),
    "export const a = 2;\nexport const b = 3;\n",
  );
  await waitFor(
    view,
    `document.querySelectorAll(".code tr[data-line]").length === 2`,
  );
  expect(
    await view.evaluate(`document.querySelector(".code-src").textContent`),
  ).toBe("export const a = 2;");

  writeFileSync(join(root, "b.md"), "# B\n");
  await waitFor(view, `!!document.querySelector('[data-path="b.md"]')`);
  expect(await view.evaluate("window.notReloaded")).toBe(true);
}, 30_000);
