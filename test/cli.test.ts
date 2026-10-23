import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openReviewDb } from "../src/review/db";
import { ReviewStore } from "../src/review/store";
import { openSession } from "../src/session/session";

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

describe("akapen export", () => {
  const exportRoot = join(base, "export-project");
  Bun.spawnSync(["mkdir", "-p", exportRoot]);

  beforeAll(() => {
    const { meta } = openSession(home, realpathSync(exportRoot));
    const store = new ReviewStore(
      openReviewDb(join(home, "sessions", meta.id, "review.db")),
    );
    const make = (line: number, body: string) =>
      store.createThread({
        path: "a.md",
        startLine: line,
        endLine: line,
        anchorText: `line ${line}`,
        fileSha: "x",
        originView: "source",
        author: "Alice",
        clientId: "c",
        body,
      });
    make(2, "second");
    store.resolve(make(1, "first").id, "Bob");
  });

  const exportCli = (...args: string[]) =>
    Bun.spawnSync([process.execPath, cli, "export", ...args], { env });

  test("prints open threads as a prompt by default", () => {
    const result = exportCli(exportRoot);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(
      "1. a.md:2\n  line 2\n\n  second by Alice\n",
    );
  });

  test("filters by status and prints JSONL", () => {
    const all = exportCli(exportRoot, "--status", "all");
    expect(all.stdout.toString()).toContain("1. a.md:1\n");
    const jsonl = exportCli(
      exportRoot,
      "--status",
      "resolved",
      "--format",
      "jsonl",
    )
      .stdout.toString()
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(jsonl).toHaveLength(1);
    expect(jsonl[0]).toMatchObject({
      path: "a.md",
      status: "resolved",
      resolvedBy: "Bob",
    });
  });

  test("fails without an active session for the directory", () => {
    const result = exportCli(base);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("No active session");
  });

  test("rejects unknown options", () => {
    expect(exportCli("--format", "xml").exitCode).toBe(2);
  });
});
