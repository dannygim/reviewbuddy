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
mkdirSync(join(root, "src"));
writeFileSync(join(root, "src/main.ts"), "export const x = 1;\n");
mkdirSync(join(root, "doc"));
writeFileSync(
  join(root, "doc/diagram.md"),
  "# Diagram\n\n```mermaid\ngraph TD; A-->B\n```\n",
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
    session: testSession({ readOnly: true }),
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

const BODY_BG = `getComputedStyle(document.body).backgroundColor`;
const TOKEN_COLOR = `getComputedStyle(document.querySelector(".code-src span")).color`;
// The first token's --shiki-dark hex, as the rgb() string getComputedStyle reports.
const TOKEN_DARK_RGB = `(() => {
  const hex = document
    .querySelector(".code-src span")
    .style.getPropertyValue("--shiki-dark")
    .trim();
  const n = parseInt(hex.slice(1), 16);
  return "rgb(" + [n >> 16, (n >> 8) & 255, n & 255].join(", ") + ")";
})()`;

test("follows the display mode attribute", async () => {
  await using view = webView({ width: 1000, height: 700 });
  await view.navigate(new URL("/#/doc/src/main.ts", server.url).href);
  await waitFor(view, `!!document.querySelector(".code-src span")`);

  expect(await view.evaluate(BODY_BG)).toBe("rgb(255, 255, 255)");
  const lightColor = await view.evaluate(TOKEN_COLOR);

  await view.evaluate(`document.documentElement.dataset.displayMode = "dark"`);
  expect(await view.evaluate(BODY_BG)).toBe("rgb(13, 17, 23)");
  const darkColor = await view.evaluate(TOKEN_COLOR);
  expect(darkColor).not.toBe(lightColor);
  expect(darkColor).toBe(await view.evaluate(TOKEN_DARK_RGB));

  await view.evaluate(`document.documentElement.dataset.displayMode = "light"`);
  expect(await view.evaluate(BODY_BG)).toBe("rgb(255, 255, 255)");
}, 30_000);

test("switches the display mode from the header menu and keeps it", async () => {
  await using view = webView({ width: 1000, height: 700 });
  const url = new URL("/#/doc/src/main.ts", server.url).href;
  await view.navigate(url);
  await view.evaluate(`localStorage.clear()`);
  await view.reload();
  await waitFor(
    view,
    `!!document.querySelector('[data-action="display-mode"]')`,
  );

  const BUTTON = `[data-action="display-mode"]`;
  const MENU = `document.querySelector("#display-mode-menu")`;
  const attr = `document.documentElement.getAttribute("data-display-mode")`;
  const stored = `localStorage.getItem("reviewbuddy.displayMode")`;
  const focused = `document.activeElement?.getAttribute("data-display-mode")`;
  const onButton = `document.activeElement === document.querySelector('${BUTTON}')`;

  expect(await view.evaluate(attr)).toBeNull();
  expect(
    await view.evaluate(
      `document.querySelector('${BUTTON}').getAttribute("aria-label")`,
    ),
  ).toBe("Display mode: System");

  await view.click(BUTTON);
  await waitFor(view, `${MENU}.matches(":popover-open")`);
  await waitFor(view, `${focused} === "system"`);
  expect(
    await view.evaluate(
      `document.querySelector('[data-display-mode="system"]').getAttribute("aria-checked")`,
    ),
  ).toBe("true");

  // press("ArrowDown") maps to an editing command and sends no keydown, so
  // dispatch the key event directly.
  await view.evaluate(
    `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))`,
  );
  await waitFor(view, `${focused} === "light"`);
  // Enter on a focused <button> is a native click; press("Enter") sends an
  // editing command instead of a key event, so click the focused item.
  await view.evaluate(`(document.activeElement.click(), true)`);
  await waitFor(view, `${attr} === "light"`);
  await waitFor(view, `!${MENU}.matches(":popover-open")`);
  expect(await view.evaluate(stored)).toBe("light");
  await waitFor(view, onButton);

  await view.click(BUTTON);
  await waitFor(view, `${MENU}.matches(":popover-open")`);
  await view.click(`[data-display-mode="dark"]`);
  await waitFor(view, `${attr} === "dark"`);
  expect(await view.evaluate(BODY_BG)).toBe("rgb(13, 17, 23)");

  // The mark tells the reloaded page from the old one, which reload() may
  // still show when it returns.
  await view.evaluate(`(window.beforeReload = true)`);
  await view.reload();
  await waitFor(
    view,
    `!window.beforeReload && !!document.querySelector('${BUTTON}')`,
  );
  expect(await view.evaluate(attr)).toBe("dark");

  await view.click(BUTTON);
  await waitFor(view, `${MENU}.matches(":popover-open")`);
  await view.press("Escape");
  await waitFor(view, `!${MENU}.matches(":popover-open")`);
  await waitFor(view, onButton);

  await view.click(BUTTON);
  await waitFor(view, `${MENU}.matches(":popover-open")`);
  await view.click(`[data-display-mode="system"]`);
  await waitFor(view, `${attr} === null`);
  expect(await view.evaluate(stored)).toBe("system");
}, 30_000);

test("redraws diagrams in the new scheme", async () => {
  await using view = webView({ width: 1000, height: 700 });
  const url = new URL("/#/doc/doc/diagram.md", server.url).href;
  await view.navigate(url);
  await view.evaluate(`localStorage.clear()`);
  await view.reload();
  await waitFor(view, `!!document.querySelector(".mermaid svg")`);

  // mermaid gives each render a new svg id, so strip it before comparing themes.
  const STYLE = `(s => s.textContent.replaceAll(s.closest("svg").id, ""))(document.querySelector(".mermaid svg style"))`;
  const light = await view.evaluate(STYLE);

  await view.click(`[data-action="display-mode"]`);
  await waitFor(
    view,
    `document.querySelector("#display-mode-menu").matches(":popover-open")`,
  );
  await view.click(`[data-display-mode="dark"]`);
  await waitFor(view, `${STYLE} !== ${JSON.stringify(light)}`);
  expect(
    await view.evaluate(
      `document.querySelector(".mermaid").getAttribute("data-source")`,
    ),
  ).toBe("graph TD; A-->B\n");
}, 30_000);
