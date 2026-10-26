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
