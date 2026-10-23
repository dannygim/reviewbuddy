import { afterAll, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "src", "cli.ts");
const base = realpathSync(mkdtempSync(join(tmpdir(), "akapen-cli-")));
const home = join(base, "home");
const root = join(base, "project");
Bun.spawnSync(["mkdir", "-p", root]);
afterAll(() => rmSync(base, { recursive: true, force: true }));

const env = { ...process.env, AKAPEN_HOME: home };

async function startCli(...args: string[]) {
  const proc = Bun.spawn([process.execPath, cli, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  let output = "";
  for await (const chunk of proc.stdout) {
    output += new TextDecoder().decode(chunk);
    if (output.includes("http://")) break;
  }
  return { proc, output, url: output.match(/http:\/\/\S+/)?.[0] ?? "" };
}

const lockPath = () => {
  const [id] = readdirSync(join(home, "sessions")).filter(
    (n) => n !== ".gitignore",
  );
  return join(home, "sessions", id!, "server.lock");
};

test("a second start for the same directory points at the running server", async () => {
  const first = await startCli(root, "--port", "0");
  try {
    expect(first.url).not.toBe("");
    expect(existsSync(lockPath())).toBe(true);

    const second = Bun.spawnSync([process.execPath, cli, root], { env });
    expect(second.exitCode).toBe(0);
    expect(second.stdout.toString()).toContain("already reviewing");
    expect(second.stdout.toString()).toContain(first.url);
  } finally {
    first.proc.kill("SIGTERM");
    await first.proc.exited;
  }
  expect(existsSync(lockPath())).toBe(false);
}, 30_000);

test("an unknown --session is an error", () => {
  const result = Bun.spawnSync([process.execPath, cli, "--session", "nope"], {
    env,
  });
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("Session not found: nope");
});
