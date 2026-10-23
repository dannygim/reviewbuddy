import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findRunningServer,
  isProcessAlive,
  type LockInfo,
  readLock,
  writeLock,
} from "./lock";

const base = mkdtempSync(join(tmpdir(), "akapen-lock-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
let n = 0;
const freshDir = () => mkdtempSync(join(base, `s${n++}-`));

function lock(pid: number, url = "http://127.0.0.1:1/"): LockInfo {
  return {
    pid,
    host: "127.0.0.1",
    port: 1,
    url,
    startedAt: "2026-10-23T15:30:00+09:00",
  };
}

async function deadPid(): Promise<number> {
  const proc = Bun.spawn(["true"]);
  await proc.exited;
  return proc.pid;
}

function healthServer(sessionId: string) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => Response.json({ name: "akapen", sessionId }),
  });
}

describe("lock files", () => {
  test("round-trip privately", () => {
    const dir = freshDir();
    expect(readLock(dir)).toBeNull();
    writeLock(dir, lock(123));
    expect(readLock(dir)).toEqual(lock(123));
    expect(statSync(join(dir, "server.lock")).mode & 0o777).toBe(0o600);
  });

  test("isProcessAlive", async () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(await deadPid())).toBe(false);
  });
});

describe("findRunningServer", () => {
  test("returns null without a lock", async () => {
    expect(await findRunningServer(freshDir(), "s1")).toBeNull();
  });

  test("clears the lock of a dead process", async () => {
    const dir = freshDir();
    writeLock(dir, lock(await deadPid()));
    expect(await findRunningServer(dir, "s1")).toBeNull();
    expect(existsSync(join(dir, "server.lock"))).toBe(false);
  });

  test("clears the lock when nothing answers", async () => {
    const dir = freshDir();
    writeLock(dir, lock(process.pid, "http://127.0.0.1:9/"));
    expect(await findRunningServer(dir, "s1")).toBeNull();
    expect(readLock(dir)).toBeNull();
  });

  test("clears the lock when another session answers", async () => {
    const dir = freshDir();
    await using server = healthServer("other");
    writeLock(dir, lock(process.pid, server.url.href));
    expect(await findRunningServer(dir, "s1")).toBeNull();
    expect(readLock(dir)).toBeNull();
  });

  test("returns the URL of the server running this session", async () => {
    const dir = freshDir();
    await using server = healthServer("s1");
    writeLock(dir, lock(process.pid, server.url.href));
    expect(await findRunningServer(dir, "s1")).toBe(server.url.href);
    expect(readLock(dir)).not.toBeNull();
  });
});
