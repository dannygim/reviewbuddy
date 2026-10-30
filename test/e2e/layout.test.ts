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

const root = realpathSync(mkdtempSync(join(tmpdir(), "reviewbuddy-layout-")));
mkdirSync(join(root, "doc"));
mkdirSync(join(root, "src"));
const lines = Array.from(
  { length: 30 },
  (_, i) => `const v${i + 1} = ${i + 1};`,
);
const source = lines.map((line) => `${line}\n`).join("");
writeFileSync(join(root, "src/app.ts"), source);
writeFileSync(join(root, "src/other.ts"), source);
// Long enough that the page does not scroll back up by itself when the
// cards get shorter (the app has to scroll to a clicked card).
writeFileSync(join(root, "src/many.ts"), source.repeat(3));
mkdirSync(join(root, "img"));
writeFileSync(
  join(root, "img/dot.png"),
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
);
writeFileSync(join(root, "doc/guide.md"), "# Guide\n\nFirst paragraph.\n");

let server: AppServer;
// Threads on src/app.ts, both wanting the top of line 5.
let lines5to6: string;
let line5: string;
// Threads on src/many.ts, one on each of lines 1-6.
let many: string[];

beforeAll(async () => {
  const session = testSession();
  const make = (path: string, startLine: number, endLine: number) =>
    session.store.createThread({
      path,
      startLine,
      endLine,
      anchorText: lines.slice(startLine - 1, endLine).join("\n"),
      fileSha: "x",
      originView: "source",
      author: "Bob",
      clientId: "c",
      body: `On ${startLine}-${endLine}`,
    });
  lines5to6 = make("src/app.ts", 5, 6).id;
  line5 = make("src/app.ts", 5, 5).id;
  make("src/other.ts", 5, 5);
  session.store.resolve(make("src/other.ts", 20, 20).id, "Bob");
  many = [1, 2, 3, 4, 5, 6].map((line) => make("src/many.ts", line, line).id);
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

/** Opens `path` with empty storage, as a reviewer who already has a name. */
async function open(path: string): Promise<Bun.WebView> {
  const view = webView({ width: 1280, height: 800 });
  await view.navigate(new URL("/api/health", server.url).href);
  await view.evaluate(
    `localStorage.clear() ?? localStorage.setItem("reviewbuddy.nickname", "Alice")`,
  );
  await view.navigate(new URL(`/#/doc/${path}`, server.url).href);
  return view;
}

const top = (view: Bun.WebView, selector: string) =>
  view.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top`,
  ) as Promise<number>;

const bottom = (view: Bun.WebView, selector: string) =>
  view.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().bottom`,
  ) as Promise<number>;

/** Waits until no card is still sliding to its place. */
const settled = (view: Bun.WebView) =>
  waitFor(
    view,
    `[...document.querySelectorAll(".comment-card")].every((c) => c.getAnimations().length === 0)`,
  );

async function reload(view: Bun.WebView, ready: string): Promise<void> {
  await view.evaluate(`(window.beforeReload = true) && location.reload()`);
  await waitFor(view, `!window.beforeReload && (${ready})`);
}

test("hides and shows the file tree and keeps it", async () => {
  await using view = await open("src/app.ts");
  const button = '[data-action="file-tree"]';
  const pressed = () =>
    view.evaluate(
      `document.querySelector('${button}').getAttribute("aria-pressed")`,
    );
  const width = (selector: string) =>
    view.evaluate(`document.querySelector("${selector}").offsetWidth`);
  await waitFor(view, `!!document.querySelector('[data-path="doc"]')`);
  expect(await pressed()).toBe("true");
  expect(await width(".app-sidebar")).toBeGreaterThan(0);

  await view.click(button);
  await waitFor(view, `document.querySelector(".app-sidebar").hidden`);
  expect(await pressed()).toBe("false");
  expect(await width(".app-sidebar")).toBe(0);
  expect(await width(".app-main")).toBe(await width(".app-body"));
  expect(
    await view.evaluate(`localStorage.getItem("reviewbuddy.fileTree")`),
  ).toBe("closed");

  await reload(view, `!!document.querySelector('[data-path="doc"]')`);
  expect(await pressed()).toBe("false");
  expect(await width(".app-sidebar")).toBe(0);

  await view.click(button);
  await waitFor(view, `!document.querySelector(".app-sidebar").hidden`);
  expect(await pressed()).toBe("true");
  expect(await width(".app-sidebar")).toBeGreaterThan(0);

  // Hiding the tree keeps the expanded directories.
  await view.click('[data-path="doc"]');
  await waitFor(view, `!!document.querySelector('[data-path="doc/guide.md"]')`);
  await view.click(button);
  await waitFor(view, `document.querySelector(".app-sidebar").hidden`);
  await view.click(button);
  await waitFor(view, `!document.querySelector(".app-sidebar").hidden`);
  expect(
    await view.evaluate(
      `!!document.querySelector('[data-path="doc/guide.md"]')`,
    ),
  ).toBe(true);
}, 30_000);

test("shows source threads beside their first line", async () => {
  await using view = await open("src/app.ts");
  const first = `.comment-pane [data-thread-id="${lines5to6}"]`;
  const second = `.comment-pane [data-thread-id="${line5}"]`;
  await waitFor(
    view,
    `document.querySelectorAll(".comment-pane .thread").length === 2`,
  );
  expect(
    await view.evaluate(`document.querySelectorAll(".code .thread").length`),
  ).toBe(0);
  const row5 = await top(view, 'tr[data-line="5"]');
  expect(Math.abs((await top(view, first)) - row5)).toBeLessThanOrEqual(1);
  // Both want line 5: the later one goes under the first, 8px apart.
  expect(
    Math.abs((await top(view, second)) - (await bottom(view, first)) - 8),
  ).toBeLessThanOrEqual(1);

  // The composer opens beside the selected line, not between the rows.
  await view.click('tr[data-line="25"] .code-ln');
  await waitFor(view, `!!document.querySelector(".comment-pane .composer")`);
  expect(
    Math.abs(
      (await top(view, ".comment-pane .composer")) -
        (await top(view, 'tr[data-line="25"]')),
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    await view.evaluate(`document.querySelectorAll(".code tr").length`),
  ).toBe(30);
}, 30_000);

test("lines up the thread whose card or lines are clicked", async () => {
  await using view = await open("src/app.ts");
  const first = `.comment-pane [data-thread-id="${lines5to6}"]`;
  const second = `.comment-pane [data-thread-id="${line5}"]`;
  const lit = () =>
    view.evaluate(
      `[...document.querySelectorAll("tr[data-comment-target]")].map((r) => r.dataset.line).join()`,
    );
  const beside = async (card: string, line: number) =>
    Math.abs(
      (await top(view, card)) - (await top(view, `tr[data-line="${line}"]`)),
    ) <= 1;
  await waitFor(
    view,
    `document.querySelectorAll(".comment-pane .thread").length === 2`,
  );
  expect(await beside(first, 5)).toBe(true);
  expect(await lit()).toBe("");

  // Its card: it moves beside line 5 and pushes the other one up.
  await view.click(`${second} .comment-body`);
  await waitFor(
    view,
    `document.querySelector('${second}').parentElement.classList.contains("active")`,
  );
  await settled(view);
  expect(await beside(second, 5)).toBe(true);
  expect(
    Math.abs((await top(view, second)) - (await bottom(view, first)) - 8),
  ).toBeLessThanOrEqual(1);
  expect(await lit()).toBe("5");

  // Its lines: line 6 has only the thread on lines 5-6; on line 5, the
  // smaller thread wins.
  await view.click('tr[data-line="6"] .code-src');
  await waitFor(
    view,
    `document.querySelectorAll("tr[data-comment-target]").length === 2`,
  );
  expect(await lit()).toBe("5,6");
  await settled(view);
  expect(await beside(first, 5)).toBe(true);
  await view.click('tr[data-line="5"] .code-src');
  await waitFor(
    view,
    `document.querySelector('${second}').parentElement.classList.contains("active")`,
  );

  // Anywhere else: none is active, and they stack as at first.
  await view.click('tr[data-line="20"] .code-src');
  await waitFor(view, `!document.querySelector(".comment-card.active")`);
  expect(await lit()).toBe("");
  await settled(view);
  expect(await beside(first, 5)).toBe(true);

  // Hovering a card lights up its lines.
  await view.evaluate(
    `document.querySelector('${second}').dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))`,
  );
  await waitFor(view, `!!document.querySelector("tr[data-comment-target]")`);
  expect(await lit()).toBe("5");
  await view.evaluate(
    `document.querySelector('${second}').dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))`,
  );
  await waitFor(view, `!document.querySelector("tr[data-comment-target]")`);
}, 30_000);

test("scrolls to a card pushed far down once it is clicked", async () => {
  await using view = await open("src/many.ts");
  const last = `.comment-pane [data-thread-id="${many.at(-1)}"]`;
  await waitFor(
    view,
    `document.querySelectorAll(".comment-pane .thread").length === 6`,
  );
  // Pushed below the window by the five above it.
  expect(await top(view, last)).toBeGreaterThan(800);

  await view.evaluate(`document.querySelector('${last}').scrollIntoView()`);
  await view.click(`${last} .comment-body`);
  await waitFor(
    view,
    `Math.abs(document.querySelector('${last}').getBoundingClientRect().top - document.querySelector('tr[data-line="6"]').getBoundingClientRect().top) <= 1`,
  );
  // In view, below the sticky header, once it has got there.
  await settled(view);
  expect(await top(view, last)).toBeGreaterThanOrEqual(
    await bottom(view, ".viewer-header"),
  );
  expect(await bottom(view, last)).toBeLessThanOrEqual(800);
}, 30_000);

test("closes the comment pane to markers and opens it again", async () => {
  await using view = await open("src/other.ts");
  const button = '[data-action="comment-pane"]';
  const count = (selector: string) =>
    view.evaluate(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
    );
  await waitFor(
    view,
    `document.querySelectorAll(".comment-pane .thread").length === 2`,
  );

  await view.click(button);
  await waitFor(
    view,
    `document.querySelectorAll(".comment-marker").length === 2`,
  );
  expect(
    await view.evaluate(
      `document.querySelector('${button}').getAttribute("aria-pressed")`,
    ),
  ).toBe("false");
  expect(
    await view.evaluate(`document.querySelector(".comment-pane").offsetWidth`),
  ).toBe(28);
  expect(await count(".comment-pane .thread")).toBe(0);
  const marker = ".comment-marker";
  expect(
    Math.abs(
      (await top(view, marker)) - (await top(view, 'tr[data-line="5"]')),
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    await view.evaluate(
      `[...document.querySelectorAll("${marker}")].map((m) => [m.title, m.dataset.status]).join()`,
    ),
  ).toBe("Line 5,open,Line 20,resolved");
  expect(
    await view.evaluate(`localStorage.getItem("reviewbuddy.commentPane")`),
  ).toBe("closed");

  await reload(
    view,
    `document.querySelectorAll(".comment-marker").length === 2`,
  );
  expect(await count(".comment-pane .thread")).toBe(0);

  // A marker opens the pane.
  await view.click(marker);
  await waitFor(
    view,
    `document.querySelectorAll(".comment-pane .thread").length === 2`,
  );
  expect(await count(".comment-marker")).toBe(0);

  // Selecting a line while it is closed opens it with the composer.
  await view.click(button);
  await waitFor(
    view,
    `document.querySelectorAll(".comment-marker").length === 2`,
  );
  await view.click('tr[data-line="10"] .code-ln');
  await waitFor(view, `!!document.querySelector(".comment-pane .composer")`);
  expect(await count(".comment-pane .thread")).toBe(2);
}, 30_000);

test("shows no comment pane for images", async () => {
  await using view = await open("img/dot.png");
  await waitFor(view, `!!document.querySelector(".viewer-image")`);
  expect(
    await view.evaluate(
      `!!document.querySelector('.comment-pane, [data-action="comment-pane"]')`,
    ),
  ).toBe(false);
}, 30_000);
