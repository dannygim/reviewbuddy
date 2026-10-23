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
import { testSession } from "../support";

const root = realpathSync(mkdtempSync(join(tmpdir(), "akapen-realtime-")));
mkdirSync(join(root, "doc"));
writeFileSync(
  join(root, "doc/notes.ts"),
  "export const a = 1;\nexport const b = 2;\n",
);
writeFileSync(
  join(root, "doc/guide.md"),
  "# Guide\n\nFirst paragraph.\n\nSecond paragraph\nspans two lines.\n\n- one\n- two\n",
);

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

async function joinAs(name: string, path: string): Promise<Bun.WebView> {
  const view = new Bun.WebView({ width: 1100, height: 800 });
  await view.navigate(new URL(`/#/doc/${path}`, server.url).href);
  await view.click(".dialog input");
  await view.type(name);
  await view.click('.dialog button[type="submit"]');
  await waitFor(view, `!document.querySelector(".dialog")`);
  return view;
}

test("comments and presence reach the other browser without a reload", async () => {
  await using alice = await joinAs("Alice", "doc/notes.ts");
  await using bob = await joinAs("Bob", "doc/notes.ts");

  await waitFor(
    alice,
    `document.querySelector(".presence")?.textContent.includes("Bob")`,
  );
  await waitFor(
    bob,
    `document.querySelector(".presence")?.textContent.includes("Alice")`,
  );

  await waitFor(
    alice,
    `document.querySelectorAll(".code tr[data-line]").length === 2`,
  );
  await alice.click('tr[data-line="2"] .code-ln');
  await alice.click(".composer textarea");
  await alice.type("Rename b?");
  await alice.click('.composer [data-action="submit"]');

  await waitFor(
    bob,
    `document.querySelector(".thread .comment-body")?.textContent === "Rename b?"`,
  );
  expect(
    await bob.evaluate(
      `document.querySelector('[data-path="doc/notes.ts"] .tree-badge')?.textContent`,
    ),
  ).toBe("1");
}, 60_000);

const hover = (view: Bun.WebView, selector: string) =>
  view.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))`,
  );

test("comments on Preview blocks show under the block and in the source", async () => {
  await using view = await joinAs("Carol", "doc/guide.md");
  await waitFor(
    view,
    `!!document.querySelector('.markdown p[data-src-start="3"]')`,
  );

  // One block.
  await hover(view, 'p[data-src-start="3"]');
  await view.click(".block-add");
  await view.click(".preview-slot .composer textarea");
  await view.type("Too short");
  await view.click('.preview-slot .composer [data-action="submit"]');
  await waitFor(
    view,
    `document.querySelector('p[data-src-start="3"]').nextElementSibling?.querySelector(".thread .comment-body")?.textContent === "Too short"`,
  );

  // Shift+click extends the selection to the next paragraph (lines 3-6).
  await hover(view, 'p[data-src-start="3"]');
  await view.click(".block-add");
  await hover(view, 'p[data-src-start="5"]');
  await view.click(".block-add", { modifiers: ["Shift"] });
  await waitFor(
    view,
    `document.querySelectorAll(".preview-selected").length === 2`,
  );
  await view.click(".preview-slot .composer textarea");
  await view.type("Merge these");
  await view.click('.preview-slot .composer [data-action="submit"]');
  await waitFor(
    view,
    `[...document.querySelectorAll(".thread-header")].some((h) => h.textContent.includes("Lines 3–6"))`,
  );
  expect(
    await view.evaluate(
      `document.querySelector('p[data-src-start="5"]').nextElementSibling?.textContent.includes("Merge these")`,
    ),
  ).toBe(true);

  // The same threads appear in the Source view under their last lines.
  await view.click('[data-mode="source"]');
  await waitFor(
    view,
    `document.querySelectorAll(".code .thread").length === 2`,
  );
  expect(
    await view.evaluate(
      `document.querySelector('tr[data-line="3"]').nextElementSibling.textContent.includes("Too short")`,
    ),
  ).toBe(true);
}, 60_000);
