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

const root = realpathSync(mkdtempSync(join(tmpdir(), "reviewbuddy-realtime-")));
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

/**
 * Opens the app as a new participant. On Linux, Bun.WebView tabs share one
 * Chrome profile, so each participant uses its own origin (host) and starts
 * from empty storage to get its own nickname and client ID.
 */
async function joinAs(
  name: string,
  path: string,
  host = "127.0.0.1",
): Promise<Bun.WebView> {
  const view = webView({ width: 1100, height: 800 });
  const origin = `http://${host}:${server.port}`;
  await view.navigate(`${origin}/api/health`);
  await view.evaluate("localStorage.clear()");
  await view.navigate(`${origin}/#/doc/${path}`);
  await view.click(".dialog input");
  await view.type(name);
  await view.click('.dialog button[type="submit"]');
  await waitFor(view, `!document.querySelector(".dialog")`);
  return view;
}

test("comments and presence reach the other browser without a reload", async () => {
  await using alice = await joinAs("Alice", "doc/notes.ts");
  await using bob = await joinAs("Bob", "doc/notes.ts", "localhost");

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

/**
 * Hovers a block and waits until the "+" button sits next to it (React
 * renders mousemove updates asynchronously).
 */
async function hover(view: Bun.WebView, selector: string): Promise<void> {
  const block = `document.querySelector(${JSON.stringify(selector)})`;
  await view.evaluate(
    `${block}.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))`,
  );
  await waitFor(
    view,
    `(() => {
      const plus = document.querySelector(".block-add");
      if (!plus) return false;
      return Math.abs(plus.getBoundingClientRect().top - ${block}.getBoundingClientRect().top) < 1;
    })()`,
  );
}

const card = (body: string) =>
  `[...document.querySelectorAll(".comment-card")].find((c) => c.textContent.includes(${JSON.stringify(body)}))?.getBoundingClientRect()`;
const cardTop = (body: string) => `${card(body)}?.top`;
const cardBottom = (body: string) => `${card(body)}?.bottom`;
const blockTop = (line: number) =>
  `document.querySelector('.markdown [data-src-start="${line}"]').getBoundingClientRect().top`;
const lit = `[...document.querySelectorAll(".markdown [data-comment-target]")].map((b) => b.dataset.srcStart).join()`;
const settled = `[...document.querySelectorAll(".comment-card")].every((c) => c.getAnimations().length === 0)`;

test("comments on Preview blocks show beside the block and in the source", async () => {
  await using view = await joinAs("Carol", "doc/guide.md");
  await waitFor(
    view,
    `!!document.querySelector('.markdown p[data-src-start="3"]')`,
  );

  // One block.
  await hover(view, 'p[data-src-start="3"]');
  await view.click(".block-add");
  await view.click(".comment-pane .composer textarea");
  await view.type("Too short");
  await view.click('.comment-pane .composer [data-action="submit"]');
  await waitFor(
    view,
    `Math.abs(${cardTop("Too short")} - ${blockTop(3)}) <= 1`,
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
  await view.click(".comment-pane .composer textarea");
  await view.type("Merge these");
  await view.click('.comment-pane .composer [data-action="submit"]');
  await waitFor(
    view,
    `[...document.querySelectorAll(".thread-header")].some((h) => h.textContent.includes("Lines 3–6"))`,
  );
  // No block holds lines 3-6, so it lines up with the first one it touches.
  // The new thread is the active one: the card already there moves up.
  await waitFor(
    view,
    `Math.abs(${cardTop("Merge these")} - ${blockTop(3)}) <= 1`,
  );
  await waitFor(view, settled);
  expect(
    await view.evaluate(
      `Math.abs(${cardTop("Merge these")} - ${cardBottom("Too short")} - 8) <= 1`,
    ),
  ).toBe(true);
  expect(await view.evaluate(lit)).toBe("3,5");

  // Clicking a block makes the smallest thread on it the active one.
  await view.click('.markdown p[data-src-start="3"]');
  await waitFor(
    view,
    `Math.abs(${cardTop("Too short")} - ${blockTop(3)}) <= 1`,
  );
  await waitFor(view, settled);
  expect(
    await view.evaluate(
      `Math.abs(${cardTop("Merge these")} - ${cardBottom("Too short")} - 8) <= 1`,
    ),
  ).toBe(true);
  expect(await view.evaluate(lit)).toBe("3");

  // The same threads appear in the Source view beside their first lines.
  await view.click('[data-mode="source"]');
  await waitFor(
    view,
    `document.querySelectorAll(".comment-pane .thread").length === 2`,
  );
  expect(
    await view.evaluate(
      `(() => {
        const card = [...document.querySelectorAll(".comment-card")].find((c) => c.textContent.includes("Too short"));
        const row = document.querySelector('tr[data-line="3"]');
        return Math.abs(card.getBoundingClientRect().top - row.getBoundingClientRect().top) <= 1;
      })()`,
    ),
  ).toBe(true);
}, 60_000);
