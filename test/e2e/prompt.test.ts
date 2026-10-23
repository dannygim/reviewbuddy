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
import { TEST_TOKEN, testSession, webView } from "../support";

const root = realpathSync(mkdtempSync(join(tmpdir(), "akapen-prompt-")));
mkdirSync(join(root, "src"));
writeFileSync(
  join(root, "src/app.ts"),
  "const a = 1;\nconst b = 2;\nconst c = 3;\n",
);

let server: AppServer;

async function comment(line: number, body: string) {
  const res = await fetch(new URL("/api/threads", server.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Akapen-Token": TEST_TOKEN,
    },
    body: JSON.stringify({
      path: "src/app.ts",
      startLine: line,
      endLine: line,
      originView: "source",
      body,
      author: "Bob",
      clientId: "c-bob",
    }),
  });
  expect(res.status).toBe(201);
}

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
  await comment(3, "Rename c");
  await comment(1, "Rename a");
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

test("copies the selected threads as a prompt, with a manual fallback", async () => {
  await using view = webView({ width: 1200, height: 800 });
  await view.navigate(new URL("/#/doc/src/app.ts", server.url).href);
  await view.click(".dialog input");
  await view.type("Alice");
  await view.click('.dialog button[type="submit"]');
  await waitFor(view, `!document.querySelector(".dialog")`);

  // Block both automatic ways of copying, so the manual dialog appears.
  await view.evaluate(`(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("blocked")) },
    });
    document.execCommand = () => false;
  })()`);

  await view.click('[data-action="review"]');
  await waitFor(
    view,
    `document.querySelectorAll(".review-list input:checked").length === 2`,
  );
  await view.click('[data-action="copy-prompt"]');
  await waitFor(view, `!!document.querySelector(".manual-copy textarea")`);
  expect(
    await view.evaluate(
      `document.querySelector(".manual-copy textarea").value`,
    ),
  ).toBe(
    "1. src/app.ts:1\n  const a = 1;\n\n  Rename a by Bob\n\n2. src/app.ts:3\n  const c = 3;\n\n  Rename c by Bob\n",
  );
  await view.click(".manual-copy .dialog-actions button");

  // Both threads are now marked as sent.
  await waitFor(
    view,
    `document.querySelector('[data-filter="sent"]').textContent === "Sent (2)"`,
  );

  // Copy again, resolving what was copied.
  await view.click(".review-footer label input");
  await view.click('[data-action="copy-prompt"]');
  await waitFor(view, `!!document.querySelector(".manual-copy textarea")`);
  await view.click(".manual-copy .dialog-actions button");
  await waitFor(
    view,
    `document.querySelector('[data-filter="open"]').textContent === "Open (0)"`,
  );
  expect(
    await view.evaluate(
      `document.querySelector('[data-action="review"]').textContent`,
    ),
  ).toBe("Review (0)");
}, 60_000);
