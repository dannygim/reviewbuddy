import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "../src/version";

const projectDir = join(import.meta.dir, "..");
const binary = join(projectDir, "dist", "akapen");
const root = mkdtempSync(join(tmpdir(), "akapen-build-"));
writeFileSync(join(root, "plain.md"), "# Plain\n");
writeFileSync(
  join(root, "diagram.md"),
  "# Diagram\n\n```mermaid\ngraph LR\n  A-->B\n```\n",
);

let proc: Bun.Subprocess<"ignore", "pipe", "inherit">;
let url: string;

beforeAll(async () => {
  const build = Bun.spawnSync([process.execPath, "run", "build"], {
    cwd: projectDir,
  });
  expect(build.exitCode, build.stderr.toString()).toBe(0);

  proc = Bun.spawn([binary, root], { stdout: "pipe" });
  let output = "";
  for await (const chunk of proc.stdout) {
    output += new TextDecoder().decode(chunk);
    if (output.includes("http://")) break;
  }
  url = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0] ?? "";
  expect(url, output).not.toBe("");
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

test("the compiled binary serves the app", async () => {
  const health = await fetch(new URL("/api/health", url)).then((r) => r.json());
  expect(health).toMatchObject({ name: "akapen", version: VERSION });
  const html = await fetch(url).then((r) => r.text());
  expect(html).toContain('<div id="root"></div>');
});

test("the compiled binary loads Mermaid only for documents that use it", async () => {
  await using view = new Bun.WebView({ width: 1000, height: 700 });
  const waitFor = async (expression: string) => {
    const deadline = Date.now() + 15_000;
    while (!(await view.evaluate(expression))) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${expression}`);
      await Bun.sleep(50);
    }
  };
  const scriptBytes = () =>
    view.evaluate(
      `performance.getEntriesByType("resource").filter((e) => e.name.endsWith(".js")).reduce((sum, e) => sum + e.decodedBodySize, 0)`,
    ) as Promise<number>;

  await view.navigate(`${url}#/doc/plain.md`);
  await waitFor(`!!document.querySelector(".markdown h1")`);
  const withoutMermaid = await scriptBytes();

  await view.evaluate(`location.hash = "#/doc/diagram.md"`);
  await waitFor(`!!document.querySelector(".mermaid svg")`);
  const withMermaid = await scriptBytes();

  expect(withoutMermaid).toBeLessThan(1_500_000);
  expect(withMermaid - withoutMermaid).toBeGreaterThan(1_000_000);
}, 60_000);
