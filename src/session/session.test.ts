import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listSessions,
  newSessionId,
  openSession,
  readSession,
  SessionError,
  sessionDir,
  touchSession,
} from "./session";

const base = mkdtempSync(join(tmpdir(), "reviewbuddy-session-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
let n = 0;
const freshHome = () => join(base, `home${n++}`);
const at = (iso: string) => new Date(iso);

describe("newSessionId", () => {
  test("combines the local time, a normalized root name and 4 hex digits", () => {
    const id = newSessionId(
      "/w/My Project!",
      new Date(2026, 9, 23, 15, 30),
      () => 0.5,
    );
    expect(id).toBe("20261023-1530-my-project-8000");
  });

  test("shortens long names and falls back to 'root'", () => {
    const now = new Date(2026, 0, 2, 3, 4);
    expect(newSessionId(`/w/${"a".repeat(40)}`, now, () => 0)).toBe(
      `20260102-0304-${"a".repeat(32)}-0000`,
    );
    expect(newSessionId("/", now, () => 0)).toBe("20260102-0304-root-0000");
    expect(newSessionId("/w/日本語", now, () => 0)).toBe(
      "20260102-0304-root-0000",
    );
  });
});

describe("openSession", () => {
  test("creates a session, then resumes it for the same root", () => {
    const home = freshHome();
    const first = openSession(home, "/w/p", {}, at("2026-10-23T06:30:00Z"));
    expect(first.readOnly).toBe(false);
    expect(first.meta).toMatchObject({
      schemaVersion: 1,
      root: "/w/p",
      status: "active",
      endedAt: null,
    });
    expect(statSync(sessionDir(home, first.meta.id)).mode & 0o777).toBe(0o700);

    const again = openSession(home, "/w/p", {}, at("2026-10-23T07:00:00Z"));
    expect(again.meta.id).toBe(first.meta.id);
    expect(openSession(home, "/w/other").meta.id).not.toBe(first.meta.id);
  });

  test("with fresh, ends the active session and starts a new one", () => {
    const home = freshHome();
    const old = openSession(home, "/w/p").meta;
    const next = openSession(home, "/w/p", { fresh: true }).meta;
    expect(next.id).not.toBe(old.id);
    expect(readSession(home, old.id)).toMatchObject({ status: "ended" });
    expect(readSession(home, old.id)?.endedAt).not.toBeNull();
  });

  test("with an id, opens that session, read-only once ended", () => {
    const home = freshHome();
    const old = openSession(home, "/w/p").meta;
    openSession(home, "/w/p", { fresh: true });
    expect(openSession(home, "/w/p", { id: old.id })).toMatchObject({
      meta: { id: old.id, status: "ended" },
      readOnly: true,
    });
    expect(() => openSession(home, "/w/p", { id: "nope" })).toThrow(
      SessionError,
    );
  });

  test("skips sessions whose session.json is unreadable", () => {
    const home = freshHome();
    openSession(home, "/w/p");
    mkdirSync(join(home, "sessions", "broken"));
    writeFileSync(join(home, "sessions", "broken", "session.json"), "{oops");
    expect(listSessions(home)).toHaveLength(1);
  });
});

describe("touchSession", () => {
  test("records activity at most once a minute", () => {
    const home = freshHome();
    const { meta } = openSession(home, "/w/p", {}, at("2026-10-23T06:00:00Z"));
    const same = touchSession(home, meta, at("2026-10-23T06:00:59Z"));
    expect(same).toBe(meta);
    const later = touchSession(home, meta, at("2026-10-23T06:01:00Z"));
    expect(Date.parse(later.lastActiveAt)).toBe(
      Date.parse("2026-10-23T06:01:00Z"),
    );
    expect(readSession(home, meta.id)?.lastActiveAt).toBe(later.lastActiveAt);
  });
});
