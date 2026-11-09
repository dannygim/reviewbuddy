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

const root = realpathSync(mkdtempSync(join(tmpdir(), "reviewbuddy-comments-")));
mkdirSync(join(root, "src"));
// Enough lines to select a range in the middle.
writeFileSync(
  join(root, "src/app.ts"),
  Array.from({ length: 30 }, (_, i) => `const v${i + 1} = ${i + 1};\n`).join(
    "",
  ),
);
// Longer than the window, to comment far down.
writeFileSync(
  join(root, "src/long.ts"),
  Array.from({ length: 150 }, (_, i) => `const v${i + 1} = ${i + 1};\n`).join(
    "",
  ),
);
writeFileSync(
  join(root, "long.md"),
  Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}.\n\n`).join(""),
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

const text = (view: Bun.WebView, selector: string) =>
  view.evaluate(
    `document.querySelector(${JSON.stringify(selector)})?.textContent`,
  );

test("comments on source lines, then replies and resolves", async () => {
  await using view = webView({ width: 1100, height: 800 });
  await view.navigate(new URL("/#/doc/src/app.ts", server.url).href);

  // First visit: pick a nickname.
  await view.click(".dialog input");
  await view.type("Alice");
  await view.click('.dialog button[type="submit"]');
  await waitFor(view, `!document.querySelector(".dialog")`);
  await waitFor(
    view,
    `document.querySelectorAll(".code tr[data-line]").length === 30`,
  );

  // Select lines 9-10 and comment. Clicking 9 opens the composer; the
  // Shift+click must still select exactly 9-10.
  await view.click('tr[data-line="9"] .code-ln');
  await view.click('tr[data-line="10"] .code-ln', { modifiers: ["Shift"] });
  await waitFor(
    view,
    `document.querySelectorAll(".code tr.selected").length === 2`,
  );
  await view.click(".composer textarea");
  await view.type("Please rename these");
  await view.click('.composer [data-action="submit"]');
  await waitFor(view, `!!document.querySelector(".thread")`);
  expect(await text(view, ".thread-header")).toContain("Lines 9–10");
  expect(await text(view, ".comment-meta strong")).toBe("Alice");
  expect(await text(view, '[data-path="src/app.ts"] .tree-badge')).toBe("1");

  // Reply.
  await view.click('.thread [data-action="reply"]');
  await view.click(".thread .composer textarea");
  await view.type("Done");
  await view.click('.thread .composer [data-action="submit"]');
  await waitFor(
    view,
    `document.querySelectorAll(".thread .comment").length === 2`,
  );

  // Resolve: the badge goes away.
  await view.click('.thread [data-action="resolve"]');
  await waitFor(
    view,
    `document.querySelector(".thread").dataset.status === "resolved"`,
  );
  await waitFor(
    view,
    `!document.querySelector('[data-path="src/app.ts"] .tree-badge')`,
  );

  // After a reload the thread is still there and the nickname is remembered.
  // The mark tells the reloaded page from the old one, which reload() may
  // still show when it returns.
  await view.evaluate("window.beforeReload = true");
  await view.reload();
  await waitFor(
    view,
    `!window.beforeReload && !!document.querySelector('.thread[data-status="resolved"]')`,
  );
  expect(await view.evaluate(`!!document.querySelector(".dialog")`)).toBe(
    false,
  );
  expect(await text(view, ".app-me")).toBe("Alice (you)");
}, 60_000);

test("starts a comment far down a file where it is, without scrolling to the top", async () => {
  await using view = webView({ width: 1100, height: 800 });
  await view.navigate(new URL("/#/doc/long.md", server.url).href);
  await view.evaluate(`localStorage.setItem("reviewbuddy.nickname", "Alice")`);
  await view.evaluate("window.beforeReload = true");
  await view.reload();
  await waitFor(view, `!window.beforeReload`);

  const scrollTop = `document.querySelector(".app-main").scrollTop`;
  // Where the composer's card was when its text box got the focus: a new
  // card is at the top of the file until it is placed, and focusing it there
  // scrolls the file to the top (Chrome).
  const watchFocus = () =>
    view.evaluate(`(() => {
      window.focusedCardTop = undefined;
      document.addEventListener("focusin", (e) => {
        window.focusedCardTop = e.target.closest(".comment-card")?.style.top ?? null;
      }, { capture: true, once: true });
    })()`);
  const expectComposerInPlace = async (before: number) => {
    await waitFor(view, `window.focusedCardTop !== undefined`);
    expect(await view.evaluate("window.focusedCardTop")).not.toBe("");
    expect(
      await view.evaluate(
        `document.activeElement === document.querySelector(".comment-pane .composer textarea")`,
      ),
    ).toBe(true);
    await Bun.sleep(400); // a jump would have happened by now
    expect(await view.evaluate(scrollTop)).toBe(before);
  };

  // A Preview block.
  const block = `document.querySelectorAll(".markdown p[data-src-start]")[49]`;
  await waitFor(view, `!!${block}`);
  await view.evaluate(`${block}.scrollIntoView({ block: "center" })`);
  const previewTop = await view.evaluate<number>(scrollTop);
  expect(previewTop).toBeGreaterThan(0);
  await view.evaluate(
    `${block}.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))`,
  );
  await waitFor(
    view,
    `Math.abs(document.querySelector(".block-add")?.getBoundingClientRect().top - ${block}.getBoundingClientRect().top) < 1`,
  );
  await watchFocus();
  await view.click(".block-add");
  await expectComposerInPlace(previewTop);

  // Source lines.
  await view.navigate(new URL("/?source#/doc/src/long.ts", server.url).href);
  const line = `document.querySelector('tr[data-line="120"] .code-ln')`;
  await waitFor(view, `!!${line}`);
  await view.evaluate(`${line}.scrollIntoView({ block: "center" })`);
  const sourceTop = await view.evaluate<number>(scrollTop);
  expect(sourceTop).toBeGreaterThan(0);
  await watchFocus();
  await view.click('tr[data-line="120"] .code-ln');
  await expectComposerInPlace(sourceTop);
}, 60_000);
