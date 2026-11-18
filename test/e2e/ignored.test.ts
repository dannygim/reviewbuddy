import { afterAll, beforeAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { FileIndex } from "../../src/files/file-index";
import { type AppServer, startServer } from "../../src/server";
import {
  gitRepo,
  TEST_TOKEN,
  testSession,
  webView,
  writeFiles,
} from "../support";

const root = gitRepo({
  ".gitignore": "node_modules/\nnotes/\n.env\n",
  "README.md": "# Project\n",
  "src/app.ts": "const a = 1;\n",
});
writeFiles(root, {
  ".env": "SECRET=1\n",
  "notes/todo.md": "# Todo\n\nShip v0.8.\n",
  "node_modules/pkg/index.js": "module.exports = 1;\n",
  "node_modules/pkg/README.md": "# pkg\n",
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
    // Every browser here is on this machine: the ones on localhost stand in
    // for participants.
    isOwner: (req) =>
      req.headers.get("host")?.startsWith("127.0.0.1:") ?? false,
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

/** Opens the app with empty storage: on 127.0.0.1 as the owner, on localhost as a participant. */
async function joinAs(
  name: string,
  path: string,
  host = "127.0.0.1",
): Promise<Bun.WebView> {
  const view = webView({ width: 1200, height: 800 });
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

const BUTTON = '[data-action="ignored-files"]';
const has = (selector: string) =>
  `!!document.querySelector(${JSON.stringify(selector)})`;
const pressed = (view: Bun.WebView) =>
  view.evaluate(`document.querySelector('${BUTTON}').ariaPressed`);
const topLevel = `[...document.querySelectorAll(".tree > ul > li > button")].map((b) => b.dataset.path)`;

/** Hovers a Preview block and waits until its "+" button sits next to it. */
async function hover(view: Bun.WebView, selector: string): Promise<void> {
  const block = `document.querySelector(${JSON.stringify(selector)})`;
  await view.evaluate(
    `${block}.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))`,
  );
  await waitFor(
    view,
    `Math.abs(document.querySelector(".block-add")?.getBoundingClientRect().top - ${block}.getBoundingClientRect().top) < 1`,
  );
}

test("the owner shows ignored files, opens one and comments on it", async () => {
  await using view = await joinAs("Alice", "README.md");
  await waitFor(view, has('[data-path="README.md"]'));
  await waitFor(view, has(BUTTON));
  expect(await pressed(view)).toBe("false");
  expect(await view.evaluate(has(".tree-ignored"))).toBe(false);

  // Shown in tree order, folded directories as directories.
  await view.click(BUTTON);
  await waitFor(view, has('.tree-ignored[data-path=".env"]'));
  expect(await pressed(view)).toBe("true");
  expect(await view.evaluate(topLevel)).toEqual([
    "node_modules",
    "notes",
    "src",
    ".env",
    ".gitignore",
    "README.md",
  ]);

  // A folded directory loads as it opens, without opening its README.md.
  await view.click('[data-path="node_modules"]');
  await waitFor(view, has('.tree-ignored[data-path="node_modules/pkg"]'));
  await view.click('[data-path="node_modules/pkg"]');
  await waitFor(view, has('[data-path="node_modules/pkg/README.md"]'));
  await Bun.sleep(200);
  expect(await view.evaluate("location.hash")).toBe("#/doc/README.md");

  // Open an ignored Markdown file and comment on it.
  await view.click('[data-path="notes"]');
  await view.click('[data-path="notes/todo.md"]');
  await waitFor(view, has('.markdown p[data-src-start="3"]'));
  await hover(view, 'p[data-src-start="3"]');
  await view.click(".block-add");
  await view.click(".comment-pane .composer textarea");
  await view.type("Before the release");
  await view.click('.comment-pane .composer [data-action="submit"]');
  await waitFor(view, has('[data-path="notes/todo.md"] .tree-badge'));
  expect(await view.evaluate(has(".thread [data-action='reply']"))).toBe(true);

  // Still shown after a reload, with the open file revealed.
  await view.evaluate("window.beforeReload = true");
  await view.reload();
  await waitFor(
    view,
    `!window.beforeReload && ${has('.tree-ignored[data-path="notes/todo.md"]')}`,
  );
  expect(await pressed(view)).toBe("true");

  // Hidden again: gone from the tree, while the open file stays.
  await view.click(BUTTON);
  await waitFor(view, `!${has(".tree-ignored")}`);
  expect(await view.evaluate(has('.markdown p[data-src-start="3"]'))).toBe(
    true,
  );
}, 60_000);

test("participants get no ignored files and only read their threads", async () => {
  // Made by the owner (this process connects from 127.0.0.1).
  const res = await fetch(new URL("/api/threads", server.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Reviewbuddy-Token": TEST_TOKEN,
    },
    body: JSON.stringify({
      path: ".env",
      startLine: 1,
      endLine: 1,
      originView: "source",
      body: "Rotate this",
      author: "Alice",
      clientId: "c-alice",
    }),
  });
  expect(res.status).toBe(201);

  await using view = await joinAs("Bob", "README.md", "localhost");
  await waitFor(view, has('[data-path="README.md"]'));
  expect(await view.evaluate(has(BUTTON))).toBe(false);

  // The thread is listed but cannot be opened, and nothing can be copied.
  await view.click('[data-action="review"]');
  const item = `[...document.querySelectorAll(".review-list li")].find((li) => li.textContent.includes("Rotate this"))`;
  await waitFor(view, `!!${item}`);
  expect(await view.evaluate(`${item}.querySelector("button").disabled`)).toBe(
    true,
  );
  expect(await view.evaluate(`!!${item}.querySelector("input")`)).toBe(false);
  expect(await view.evaluate(has('[data-action="copy-prompt"]'))).toBe(false);

  // An ignored file is unknown to participants.
  // Only the hash changes, so navigate() would wait for a load that never comes.
  await view.evaluate(`location.hash = "#/doc/.env"`);
  await waitFor(
    view,
    `document.querySelector(".viewer-note")?.textContent === "File not found"`,
  );
}, 60_000);

test("the owner copies prompts with threads on ignored files", async () => {
  await using view = await joinAs("Alice", "README.md");
  // Block both automatic ways of copying, so the manual dialog shows the text.
  await view.evaluate(`(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("blocked")) },
    });
    document.execCommand = () => false;
  })()`);
  await view.click('[data-action="review"]');
  await waitFor(view, has('[data-action="copy-prompt"]:not(:disabled)'));
  await view.click('[data-action="copy-prompt"]');
  await waitFor(view, has(".manual-copy textarea"));
  const text = await view.evaluate<string>(
    `document.querySelector(".manual-copy textarea").value`,
  );
  expect(text).toContain(".env:1");
  expect(text).toContain("notes/todo.md:3");
}, 60_000);
