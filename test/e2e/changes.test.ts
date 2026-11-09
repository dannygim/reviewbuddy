import { afterAll, beforeAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { FileIndex } from "../../src/files/file-index";
import { type AppServer, startServer } from "../../src/server";
import type { Thread } from "../../src/shared/api";
import { git, gitRepo, testSession, webView, writeFiles } from "../support";

const lines = (n: number, value = (i: number) => String(i)) =>
  Array.from(
    { length: n },
    (_, i) => `const v${i + 1} = ${value(i + 1)};\n`,
  ).join("");

const root = gitRepo({
  "src/app.ts": lines(30),
  "doc/guide.md": "# Guide\n\nHello world\n\n- keep\n- old item\n",
  "README.md": "# Readme\n",
});
// HEAD is one commit ahead of main: compared with main, that commit is a change too.
git(root, "branch", "-q", "-M", "main");
git(root, "checkout", "-q", "-b", "feature");
writeFiles(root, { "src/feature.ts": "export const feature = 1;\n" });
git(root, "add", "src/feature.ts");
git(root, "commit", "-q", "-m", "feature");
// Line 15 changes, and a line is inserted after line 20 (new line 21).
const edited = lines(30, (i) => (i === 15 ? "150" : String(i))).replace(
  "const v20 = 20;\n",
  "const v20 = 20;\nconst extra = 0;\n",
);
writeFiles(root, {
  "src/app.ts": edited,
  "doc/guide.md": "# Guide\n\nHello there\n\n- keep\n- new item\n",
  "notes.txt": "a note\n",
});

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
    watch: true,
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

const text = (view: Bun.WebView, selector: string) =>
  view.evaluate(
    `document.querySelector(${JSON.stringify(selector)})?.textContent`,
  );

const card = (path: string) => `[data-diff-path="${path}"]`;
/** A JS expression for the element matching `selector`. */
const q = (selector: string) =>
  `document.querySelector(${JSON.stringify(selector)})`;
const expanded = (path: string) =>
  `${q(`${card(path)} .diff-card-toggle`)}.getAttribute("aria-expanded")`;

/** Opens the Changes view as Alice, with nothing marked Viewed. */
async function open(view: Bun.WebView) {
  await view.navigate(new URL("/#/changes", server.url).href);
  await view.evaluate(
    `(localStorage.clear(), localStorage.setItem("reviewbuddy.nickname", "Alice"))`,
  );
  await view.evaluate("window.beforeReload = true");
  await view.reload();
  await waitFor(
    view,
    `!window.beforeReload && document.querySelectorAll(".diff-card").length === 3`,
  );
}

test("shows the uncommitted changes like a pull request", async () => {
  await using view = webView({ width: 1280, height: 900 });
  await open(view);

  expect(await text(view, '[data-action="changes"]')).toBe("Changes 3");
  expect(
    await text(
      view,
      '[aria-label="Changed files"] [data-path="src/app.ts"] .tree-status',
    ),
  ).toBe("M");
  expect(
    await text(
      view,
      '[aria-label="Changed files"] [data-path="notes.txt"] .tree-status',
    ),
  ).toBe("A");

  // Old and new line numbers, the changed word marked on both sides.
  await waitFor(
    view,
    `!!${q(`${card("src/app.ts")} tr.diff-add[data-new="15"]`)}`,
  );
  expect(
    await text(
      view,
      `${card("src/app.ts")} tr.diff-del[data-old="15"] .diff-word`,
    ),
  ).toBe("15");
  expect(
    await text(
      view,
      `${card("src/app.ts")} tr.diff-add[data-new="15"] .diff-word`,
    ),
  ).toBe("150");
  expect(
    await text(
      view,
      `${card("src/app.ts")} tr.diff-add[data-new="21"] .code-src`,
    ),
  ).toBe("const extra = 0;");
  expect(await text(view, `${card("src/app.ts")} tr.diff-hunk .code-src`)).toBe(
    "@@ -12,12 +12,13 @@ const v14 = 14;",
  );
}, 60_000);

test("expands the lines above the first change into its hunk", async () => {
  await using view = webView({ width: 1280, height: 900 });
  await open(view);
  const app = card("src/app.ts");
  await waitFor(
    view,
    `!!${q(`${app} tr.diff-hunk [aria-label="Expand all"]`)}`,
  );
  await view.click(`${app} tr.diff-hunk [aria-label="Expand all"]`);
  await waitFor(view, `!!${q(`${app} tr[data-new="1"]`)}`);
  // The header stays first and now starts at line 1.
  expect(await view.evaluate(`${q(`${app} tbody tr`)}.className`)).toBe(
    "diff-hunk",
  );
  expect(await text(view, `${app} tr.diff-hunk .code-src`)).toStartWith(
    "@@ -1,23 +1,24 @@",
  );
}, 60_000);

test("keeps Viewed across a reload and closes the viewed card", async () => {
  await using view = webView({ width: 1280, height: 900 });
  await open(view);
  await view.click(`${card("notes.txt")} .diff-viewed input`);
  await waitFor(view, `${expanded("notes.txt")} === "false"`);
  expect(await text(view, '[data-role="viewed-count"]')).toBe("1 / 3 viewed");
  expect(
    await view.evaluate(
      `${q('[aria-label="Changed files"] [data-path="notes.txt"]')}.classList.contains("tree-viewed")`,
    ),
  ).toBe(true);

  await view.evaluate("window.beforeReload = true");
  await view.reload();
  await waitFor(
    view,
    `!window.beforeReload && ${q('[data-role="viewed-count"]')}?.textContent === "1 / 3 viewed"`,
  );
  expect(await view.evaluate(expanded("notes.txt"))).toBe("false");
}, 60_000);

test("comments on an added line by its new line number", async () => {
  await using view = webView({ width: 1280, height: 900 });
  await open(view);
  const added = `${card("src/app.ts")} tr[data-new="21"]`;
  await waitFor(view, `!!${q(added)}`);

  // Old numbers are not selectable; the new number is.
  await view.click(`${added} td:nth-child(2)`);
  await waitFor(view, `!!${q(`${card("src/app.ts")} .composer textarea`)}`);
  await view.click(`${card("src/app.ts")} .composer textarea`);
  await view.type("Why is this needed?");
  await view.click(`${card("src/app.ts")} .composer [data-action="submit"]`);
  await waitFor(view, `!!${q(`${card("src/app.ts")} .thread`)}`);
  expect(await text(view, `${card("src/app.ts")} .thread-header`)).toContain(
    "Line 21",
  );

  const threads = (await (
    await fetch(new URL("/api/threads", server.url))
  ).json()) as Thread[];
  expect(threads.map((t) => [t.path, t.startLine, t.endLine])).toContainEqual([
    "src/app.ts",
    21,
    21,
  ]);
}, 60_000);

test("renders the Markdown changes and switches to the source diff", async () => {
  await using view = webView({ width: 1280, height: 900 });
  await open(view);
  const md = card("doc/guide.md");
  await waitFor(view, `!!${q(`${md} .markdown`)}`);
  expect(await text(view, `${md} .markdown p del`)).toBe("world");
  expect(await text(view, `${md} .markdown p ins`)).toBe("there");
  expect(await text(view, `${md} .markdown li del`)).toBe("old");
  expect(await text(view, `${md} .markdown li ins`)).toBe("new");

  await view.click(`${md} [aria-label="Source diff"]`);
  await waitFor(view, `!!${q(`${md} .code.diff`)}`);
}, 60_000);

test("follows edits on disk and reopens a viewed file that changed", async () => {
  await using view = webView({ width: 1280, height: 900 });
  await open(view);
  await view.click(`${card("src/app.ts")} .diff-viewed input`);
  await waitFor(view, `${expanded("src/app.ts")} === "false"`);

  writeFiles(root, {
    "src/app.ts": edited.replace("const v2 = 2;", "const v2 = 20;"),
  });
  await waitFor(
    view,
    `!!${q(`${card("src/app.ts")} tr.diff-add[data-new="2"]`)}`,
  );
  expect(
    await view.evaluate(
      `${q(`${card("src/app.ts")} .diff-viewed input`)}.checked`,
    ),
  ).toBe(false);
  expect(await view.evaluate(expanded("src/app.ts"))).toBe("true");
}, 60_000);

test("goes back to the files from the Changes view", async () => {
  await using view = webView({ width: 1280, height: 900 });
  await open(view);
  await view.click('[data-action="files"]');
  await waitFor(view, `location.hash === "#/doc/README.md"`);
  await waitFor(view, `!!${q('[aria-label="Files"] [data-path="README.md"]')}`);
}, 60_000);

test("compares with the branch chosen in the list, kept in the URL", async () => {
  await using view = webView({ width: 1280, height: 900 });
  await open(view);
  const select = q(".changes-base select");
  expect(
    await view.evaluate(`[...${select}.options].map((o) => o.value).join()`),
  ).toBe(",main");
  const choose = (value: string) =>
    view.evaluate(
      `(${select}.value = ${JSON.stringify(value)}, ${select}.dispatchEvent(new Event("change", { bubbles: true })))`,
    );
  const cards = `document.querySelectorAll(".diff-card").length`;

  await choose("main");
  await waitFor(view, `${cards} === 4`);
  expect(await view.evaluate("location.hash")).toBe("#/changes?base=main");
  expect(await text(view, '[data-action="changes"]')).toBe("Changes 4");
  await waitFor(
    view,
    `!!${q(`${card("src/feature.ts")} tr.diff-add[data-new="1"]`)}`,
  );

  await view.evaluate("window.beforeReload = true");
  await view.reload();
  await waitFor(
    view,
    `!window.beforeReload && ${select}?.value === "main" && ${cards} === 4`,
  );

  // Back from the files, to the same branch.
  await view.click('[data-action="files"]');
  await waitFor(view, `location.hash.startsWith("#/doc/")`);
  await view.click('[data-action="changes"]');
  await waitFor(
    view,
    `location.hash === "#/changes?base=main" && ${select}?.value === "main"`,
  );

  await choose("");
  await waitFor(view, `${cards} === 3`);
  expect(await view.evaluate("location.hash")).toBe("#/changes");
}, 60_000);
