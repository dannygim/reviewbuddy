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
import { type AppServer, startServer } from "../../src/server";
import { testSession, webView } from "../support";

const root = realpathSync(mkdtempSync(join(tmpdir(), "reviewbuddy-e2e-")));
mkdirSync(join(root, "doc"));
mkdirSync(join(root, "guide"));
mkdirSync(join(root, "src"));
writeFileSync(join(root, "doc/A.md"), "# A\n\nbody\n");
writeFileSync(join(root, "doc/B.md"), "# B\n\nbody\n");
writeFileSync(join(root, "guide/README.md"), "# Guide\n");
writeFileSync(join(root, "guide/intro.md"), "# Intro\n");
writeFileSync(join(root, "src/main.ts"), "export const x = 1;\n");
writeFileSync(join(root, "mise.toml"), "[tools]\n");

let server: AppServer;

beforeAll(async () => {
  const session = testSession({ readOnly: true });
  const make = (path: string, body: string) =>
    session.store.createThread({
      path,
      startLine: 1,
      endLine: 1,
      anchorText: "line 1",
      fileSha: "x",
      originView: "source",
      author: "Alice",
      clientId: "c",
      body,
    });
  make("doc/A.md", "first");
  make("doc/A.md", "second");
  session.store.resolve(make("doc/B.md", "done").id, "Bob");
  make("src/main.ts", "look");
  server = startServer({
    root,
    host: "127.0.0.1",
    port: 0,
    strictPort: true,
    index: await FileIndex.create(root),
    allowedHosts: [],
    maxHighlightBytes: 2_000_000,
    session,
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

test("marks files and collapsed directories with threads", async () => {
  await using view = webView({ width: 1000, height: 700 });
  await view.navigate(server.url.href);
  const q = (selector: string, prop: string) =>
    view.evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.${prop}`,
    );

  await waitFor(
    view,
    `!!document.querySelector('[data-path="doc"] .tree-dot')`,
  );
  expect(await q('[data-path="doc"] .tree-dot', "title")).toBe(
    "Open threads inside",
  );
  expect(await q('[data-path="src"] .tree-dot', "title")).toBe(
    "Open threads inside",
  );

  await view.click('[data-path="doc"]');
  await waitFor(view, `!!document.querySelector('[data-path="doc/A.md"]')`);
  expect(await q('[data-path="doc"] .tree-dot', "title")).toBeUndefined();

  const badge = '[data-path="doc/A.md"] .tree-badge';
  await waitFor(view, `!!document.querySelector('${badge}')`);
  expect(await q(badge, "textContent")).toBe("2");
  expect(await q(badge, "title")).toBe("2 open threads");
  expect(await q(`${badge} svg`, "tagName")).toBe("svg");

  const resolved = '[data-path="doc/B.md"] .tree-resolved';
  expect(await q(resolved, "title")).toBe("Resolved threads only");
  expect(
    await q('[data-path="doc/B.md"] .tree-badge', "tagName"),
  ).toBeUndefined();

  expect(
    await view.evaluate(
      `document.querySelector('[data-path="mise.toml"]').querySelector(".tree-badge, .tree-resolved, .tree-dot")`,
    ),
  ).toBeNull();
}, 30_000);

test("opens a directory's README.md when expanding it", async () => {
  await using view = webView({ width: 1000, height: 700 });
  await view.navigate(`${server.url.href}#/doc/src/main.ts`);
  const hash = () => view.evaluate(`location.hash`);
  await waitFor(view, `!!document.querySelector('[data-path="guide"]')`);

  await view.click('[data-path="guide"]');
  await waitFor(view, `location.hash === "#/doc/guide/README.md"`);
  await waitFor(
    view,
    `document.querySelector(".markdown h1")?.textContent === "Guide"`,
  );

  await view.click('[data-path="guide"]');
  await waitFor(
    view,
    `document.querySelector('[data-path="guide"]').getAttribute("aria-expanded") === "false"`,
  );
  expect(await hash()).toBe("#/doc/guide/README.md");

  await view.click('[data-path="mise.toml"]');
  await waitFor(view, `location.hash === "#/doc/mise.toml"`);
  await view.click('[data-path="doc"]');
  await waitFor(view, `!!document.querySelector('[data-path="doc/A.md"]')`);
  expect(await hash()).toBe("#/doc/mise.toml");
}, 30_000);

test("does not open the README.md when revealing a linked file", async () => {
  await using view = webView({ width: 1000, height: 700 });
  await view.navigate(`${server.url.href}#/doc/guide/intro.md`);
  await waitFor(
    view,
    `!!document.querySelector('[data-path="guide/intro.md"]')`,
  );
  expect(
    await view.evaluate(
      `document.querySelector('[data-path="guide"]').getAttribute("aria-expanded")`,
    ),
  ).toBe("true");
  expect(await view.evaluate(`location.hash`)).toBe("#/doc/guide/intro.md");
}, 30_000);

test("keeps the open file when re-expanding its directory", async () => {
  await using view = webView({ width: 1000, height: 700 });
  await view.navigate(`${server.url.href}#/doc/guide/intro.md`);
  const dir = `document.querySelector('[data-path="guide"]')`;
  await waitFor(view, `${dir}?.getAttribute("aria-expanded") === "true"`);

  await view.click('[data-path="guide"]');
  await waitFor(view, `${dir}.getAttribute("aria-expanded") === "false"`);
  await view.click('[data-path="guide"]');
  await waitFor(view, `${dir}.getAttribute("aria-expanded") === "true"`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(await view.evaluate(`location.hash`)).toBe("#/doc/guide/intro.md");
}, 30_000);
