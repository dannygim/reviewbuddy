import { expect, test } from "bun:test";
import { join } from "node:path";
import { VERSION } from "../src/version";

const projectDir = join(import.meta.dir, "..");
const binary = join(projectDir, "dist", "akapen");

test(
  "the compiled binary prints its version and serves the app",
  async () => {
    const build = Bun.spawnSync([process.execPath, "run", "build"], {
      cwd: projectDir,
    });
    expect(build.exitCode, build.stderr.toString()).toBe(0);

    const version = Bun.spawnSync([binary, "--version"]);
    expect(version.stdout.toString().trim()).toBe(VERSION);

    const proc = Bun.spawn([binary, projectDir], { stdout: "pipe" });
    try {
      let output = "";
      for await (const chunk of proc.stdout) {
        output += new TextDecoder().decode(chunk);
        if (output.includes("http://")) break;
      }
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      expect(url, output).toBeDefined();

      const health = await fetch(new URL("/api/health", url)).then((r) =>
        r.json(),
      );
      expect(health).toMatchObject({ name: "akapen", version: VERSION });
      const html = await fetch(url!).then((r) => r.text());
      expect(html).toContain('<div id="root"></div>');
    } finally {
      proc.kill();
      await proc.exited;
    }
  },
  { timeout: 60_000 },
);
