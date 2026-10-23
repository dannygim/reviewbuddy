import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writePrivateFile } from "./home";

export type LockInfo = {
  pid: number;
  host: string;
  port: number;
  /** The URL the server printed, reused when a second start finds it running. */
  url: string;
  startedAt: string;
};

const LOCK_FILE = "server.lock";

export function readLock(dir: string): LockInfo | null {
  try {
    return JSON.parse(readFileSync(join(dir, LOCK_FILE), "utf8")) as LockInfo;
  } catch {
    return null;
  }
}

export function writeLock(dir: string, info: LockInfo): void {
  writePrivateFile(join(dir, LOCK_FILE), `${JSON.stringify(info)}\n`);
}

export function removeLock(dir: string): void {
  rmSync(join(dir, LOCK_FILE), { force: true });
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as { code?: string }).code === "EPERM";
  }
}

/**
 * Returns the URL of a server already running this session, or null after
 * clearing a stale lock (dead process, nothing listening, or another session).
 */
export async function findRunningServer(
  dir: string,
  sessionId: string,
): Promise<string | null> {
  const lock = readLock(dir);
  if (!lock) return null;
  if (isProcessAlive(lock.pid)) {
    try {
      const res = await fetch(new URL("/api/health", lock.url), {
        signal: AbortSignal.timeout(2000),
      });
      const health = (await res.json()) as { sessionId?: string };
      if (health.sessionId === sessionId) return lock.url;
    } catch {
      // Not answering: treat the lock as stale.
    }
  }
  removeLock(dir);
  return null;
}
