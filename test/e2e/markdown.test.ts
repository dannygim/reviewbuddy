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

const GUIDE = [
  "# Guide",
  "",
  "- [ ] todo",
  "- [x] done",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "```ts",
  "const a = 1;",
  "```",
  "",
  "```mermaid",
  "graph LR",
  "  A-->B",
  "```",
  "",
  "<script>window.pwned = 1</script>",
  '<img src="x" onerror="window.pwned = 2">',
  "",
  "See [the other doc](./other.md).",
  "",
].join("\n");

const root = realpathSync(mkdtempSync(join(tmpdir(), "akapen-md-")));
mkdirSync(join(root, "doc"));
writeFileSync(join(root, "doc/guide.md"), GUIDE);
writeFileSync(join(root, "doc/other.md"), "# Other\n");

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
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await view.evaluate(expression)) return;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function open(path: string): Promise<Bun.WebView> {
  const view = new Bun.WebView({ width: 1000, height: 800 });
  await view.navigate(new URL(`/#/doc/${path}`, server.url).href);
  await waitFor(view, `!!document.querySelector(".markdown h1")`);
  return view;
}

test("renders the preview with source line ranges", async () => {
  await using view = await open("doc/guide.md");
  const q = (selector: string) =>
    view.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
  expect(await q('h1[data-src-start="1"][data-src-end="1"]')).toBe(true);
  expect(await q("li.task-list-item input[type=checkbox][checked]")).toBe(true);
  expect(await q('tr[data-src-start="8"]')).toBe(true);
  expect(await q('pre.code-block span[style*="--shiki-dark"]')).toBe(true);
  await waitFor(view, `!!document.querySelector(".mermaid svg .node")`);
}, 30_000);

test("does not run scripts from the Markdown", async () => {
  await using view = await open("doc/guide.md");
  await Bun.sleep(300);
  expect(await view.evaluate("window.pwned === undefined")).toBe(true);
}, 30_000);

test("switches to the source view", async () => {
  await using view = await open("doc/guide.md");
  await view.click('[data-mode="source"]');
  await waitFor(view, `document.querySelectorAll(".code tr").length === 22`);
}, 30_000);

test("follows relative links to other files", async () => {
  await using view = await open("doc/guide.md");
  // The diagram above the link shifts the layout when it renders.
  await waitFor(view, `!!document.querySelector(".mermaid svg .node")`);
  await view.click('a[href="#/doc/doc/other.md"]');
  await waitFor(
    view,
    `document.querySelector(".markdown h1")?.textContent === "Other"`,
  );
  expect(await view.evaluate("location.hash")).toBe("#/doc/doc/other.md");
}, 30_000);
