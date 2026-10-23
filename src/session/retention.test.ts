import { describe, expect, test } from "bun:test";
import { planPrune } from "./retention";
import type { SessionMeta } from "./session";

const now = new Date("2026-10-23T00:00:00Z");
const daysAgo = (n: number) =>
  new Date(now.getTime() - n * 86_400_000).toISOString();

function meta(id: string, extra: Partial<SessionMeta>): SessionMeta {
  return {
    schemaVersion: 1,
    id,
    root: `/w/${id}`,
    status: "active",
    createdAt: daysAgo(100),
    lastActiveAt: daysAgo(1),
    endedAt: null,
    appVersion: "0.1.0",
    ...extra,
  };
}

const retention = { idleDays: 60, endedDays: 14 };
const checks = { isRunning: () => false, rootExists: () => true };
const ids = (list: SessionMeta[]) => list.map((m) => m.id);

describe("planPrune", () => {
  test("ends active sessions idle for idleDays or more", () => {
    const plan = planPrune(
      [
        meta("fresh", { lastActiveAt: daysAgo(59) }),
        meta("idle", { lastActiveAt: daysAgo(60) }),
      ],
      now,
      retention,
      checks,
    );
    expect(ids(plan.end)).toEqual(["idle"]);
    expect(plan.remove).toEqual([]);
  });

  test("removes sessions ended endedDays or more ago", () => {
    const plan = planPrune(
      [
        meta("recent", { status: "ended", endedAt: daysAgo(13) }),
        meta("old", { status: "ended", endedAt: daysAgo(14) }),
      ],
      now,
      retention,
      checks,
    );
    expect(ids(plan.remove)).toEqual(["old"]);
  });

  test("0 turns each rule off", () => {
    const plan = planPrune(
      [
        meta("idle", { lastActiveAt: daysAgo(999) }),
        meta("old", { status: "ended", endedAt: daysAgo(999) }),
      ],
      now,
      { idleDays: 0, endedDays: 0 },
      checks,
    );
    expect(plan).toEqual({ end: [], remove: [] });
  });

  test("never touches a running session", () => {
    const plan = planPrune(
      [
        meta("idle", { lastActiveAt: daysAgo(999) }),
        meta("old", { status: "ended", endedAt: daysAgo(999) }),
      ],
      now,
      retention,
      { ...checks, isRunning: () => true },
    );
    expect(plan).toEqual({ end: [], remove: [] });
  });

  test("ends active sessions whose root is gone", () => {
    const plan = planPrune([meta("gone", {})], now, retention, {
      ...checks,
      rootExists: () => false,
    });
    expect(ids(plan.end)).toEqual(["gone"]);
  });
});
