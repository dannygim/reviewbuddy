import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { isProcessAlive, readLock } from "./lock";
import {
  localIso,
  type SessionMeta,
  sessionDir,
  writeSession,
} from "./session";

export type Retention = { idleDays: number; endedDays: number };
export type PrunePlan = { end: SessionMeta[]; remove: SessionMeta[] };

const DAY_MS = 86_400_000;

/**
 * Two steps, so nothing is deleted without warning: idle active sessions (or
 * ones whose root is gone) are ended, and long-ended sessions are removed.
 * Running sessions are never touched. A value of 0 turns a rule off.
 */
export function planPrune(
  sessions: SessionMeta[],
  now: Date,
  retention: Retention,
  checks: {
    isRunning: (meta: SessionMeta) => boolean;
    rootExists: (meta: SessionMeta) => boolean;
  },
): PrunePlan {
  const plan: PrunePlan = { end: [], remove: [] };
  const age = (iso: string) => now.getTime() - Date.parse(iso);
  for (const meta of sessions) {
    if (checks.isRunning(meta)) continue;
    if (meta.status === "active") {
      const idle =
        retention.idleDays > 0 &&
        age(meta.lastActiveAt) >= retention.idleDays * DAY_MS;
      if (idle || !checks.rootExists(meta)) plan.end.push(meta);
    } else if (
      retention.endedDays > 0 &&
      meta.endedAt !== null &&
      age(meta.endedAt) >= retention.endedDays * DAY_MS
    ) {
      plan.remove.push(meta);
    }
  }
  return plan;
}

export function isSessionRunning(home: string, meta: SessionMeta): boolean {
  const lock = readLock(sessionDir(home, meta.id));
  return lock !== null && isProcessAlive(lock.pid);
}

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(path) : statSync(path).size;
  }
  return total;
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Ends and removes what the plan says; returns the bytes freed. */
export function applyPrune(home: string, plan: PrunePlan, now: Date): number {
  for (const meta of plan.end) {
    writeSession(home, { ...meta, status: "ended", endedAt: localIso(now) });
  }
  let freed = 0;
  for (const meta of plan.remove) {
    const dir = sessionDir(home, meta.id);
    freed += dirSize(dir);
    rmSync(dir, { recursive: true, force: true });
  }
  return freed;
}
