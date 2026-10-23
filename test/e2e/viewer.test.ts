import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileIndex } from "../../src/files/file-index";
import { startServer } from "../../src/server";

const root = realpathSync(mkdtempSync(join(tmpdir(), "akapen-e2e-")));
mkdirSync(join(root, "doc"));
mkdirSync(join(root, "src"));
writeFileSync(join(root, "doc/A.md"), "# A\n\nbody\n");
writeFileSync(join(root, "src/main.ts"), "export const x = 1;\n");

let server: Bun.Server<undefined>;

beforeAll(async () => {
  server = startServer({
    root,
    host: "127.0.0.1",
    port: 0,
    strictPort: true,
    index: await FileIndex.create(root),
    allowedHosts: [],
    maxHighlightBytes: 2_000_000,
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

test("opens a file from the tree and reflects it in the URL", async () => {
  await using view = new Bun.WebView({ width: 1000, height: 700 });
  await view.navigate(server.url.href);
  await view.click('[data-path="src"]');
  await view.click('[data-path="src/main.ts"]');
  await waitFor(view, `document.querySelectorAll(".code tr").length === 1`);
  expect(await view.evaluate("location.hash")).toBe("#/doc/src/main.ts");
  expect(
    await view.evaluate(`document.querySelector(".code-src").textContent`),
  ).toBe("export const x = 1;");
}, 30_000);

test("opens the file named in the URL hash and reveals it in the tree", async () => {
  await using view = new Bun.WebView({ width: 1000, height: 700 });
  await view.navigate(new URL("/#/doc/doc/A.md", server.url).href);
  await waitFor(view, `!!document.querySelector(".markdown h1")`);
  expect(
    await view.evaluate(
      `document.querySelector('[data-path="doc/A.md"]').getAttribute("aria-current")`,
    ),
  ).toBe("page");
}, 30_000);
