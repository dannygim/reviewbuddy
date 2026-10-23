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

const root = realpathSync(mkdtempSync(join(tmpdir(), "akapen-comments-")));
mkdirSync(join(root, "src"));
// Long enough that the composer opening under a line pushes later lines down.
writeFileSync(
  join(root, "src/app.ts"),
  Array.from({ length: 30 }, (_, i) => `const v${i + 1} = ${i + 1};\n`).join(
    "",
  ),
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

  // Select lines 9-10 and comment. Clicking 9 opens the composer under it, so
  // line 10 moves; the Shift+click must still select exactly 9-10.
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
  await view.reload();
  await waitFor(
    view,
    `!!document.querySelector('.thread[data-status="resolved"]')`,
  );
  expect(await view.evaluate(`!!document.querySelector(".dialog")`)).toBe(
    false,
  );
  expect(await text(view, ".app-me")).toBe("Alice (you)");
}, 60_000);
