import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "../src/version";
import { webView } from "./support";

const projectDir = join(import.meta.dir, "..");
const binary = join(projectDir, "dist", "reviewbuddy");
const root = mkdtempSync(join(tmpdir(), "reviewbuddy-build-"));
writeFileSync(join(root, "plain.md"), "# Plain\n");
writeFileSync(
  join(root, "diagram.md"),
  "# Diagram\n\n```mermaid\ngraph LR\n  A-->B\n```\n",
);

let proc: Bun.Subprocess<"ignore", "pipe", "inherit">;
let url: string;
let pin: string;

beforeAll(async () => {
  const build = Bun.spawnSync([process.execPath, "run", "build"], {
    cwd: projectDir,
  });
  expect(build.exitCode, build.stderr.toString()).toBe(0);

  proc = Bun.spawn([binary, root], {
    stdout: "pipe",
    // Keep sessions out of the real ~/.config/reviewbuddy.
    env: { ...process.env, REVIEWBUDDY_HOME: join(root, ".reviewbuddy-home") },
  });
  let output = "";
  for await (const chunk of proc.stdout) {
    output += new TextDecoder().decode(chunk);
    if (/PIN: \d{3} \d{3}\n/.test(output)) break;
  }
  url = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0] ?? "";
  pin = output.match(/PIN: (\d{3} \d{3})/)?.[1] ?? "";
  expect(url, output).not.toBe("");
  expect(pin, output).not.toBe("");
}, 60_000);

afterAll(async () => {
  proc?.kill();
  await proc?.exited;
  rmSync(root, { recursive: true, force: true });
});

test("the compiled binary prints its version", () => {
  const version = Bun.spawnSync([binary, "--version"]);
  expect(version.stdout.toString().trim()).toBe(VERSION);
});

test("the compiled binary serves the app behind the PIN", async () => {
  const health = await fetch(new URL("/api/health", url)).then((r) => r.json());
  expect(health).toMatchObject({ name: "reviewbuddy", version: VERSION });
  expect((await fetch(new URL("/api/tree", url))).status).toBe(401);
  const html = await fetch(url).then((r) => r.text());
  expect(html).toContain('<div id="root"></div>');
  // Applied by an inline script so a slow bundle cannot flash the other scheme.
  const head = html.slice(0, html.indexOf("</head>"));
  expect(head).toContain("reviewbuddy.displayMode");
});

test("the compiled binary loads Mermaid only for documents that use it", async () => {
  await using view = webView({ width: 1000, height: 700 });
  const waitFor = async (expression: string) => {
    const deadline = Date.now() + 15_000;
    while (!(await view.evaluate(expression))) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${expression}`);
      await Bun.sleep(50);
    }
  };
  const scripts = () =>
    view.evaluate(
      `performance.getEntriesByType("resource").filter((e) => e.name.endsWith(".js")).map((e) => e.decodedBodySize)`,
    ) as Promise<number[]>;
  const sum = (sizes: number[]) => sizes.reduce((a, b) => a + b, 0);

  // The login dialog itself is covered by test/e2e/login.test.ts.
  await view.navigate(`${url}api/health`);
  await view.evaluate(
    `fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "${pin}" }) })`,
  );
  await view.navigate(`${url}#/doc/plain.md`);
  await waitFor(`!!document.querySelector(".markdown h1")`);
  const before = await scripts();

  await view.evaluate(`location.hash = "#/doc/diagram.md"`);
  // The flowchart's nodes exist only once Mermaid has finished rendering.
  await waitFor(`!!document.querySelector(".mermaid svg .node")`);
  const after = await scripts();

  expect(sum(before)).toBeLessThan(1_500_000);
  expect(after.length).toBeGreaterThan(before.length);
  expect(sum(after) - sum(before)).toBeGreaterThan(300_000);
}, 60_000);
