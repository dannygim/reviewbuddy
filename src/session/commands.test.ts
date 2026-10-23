import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  endSessionCommand,
  listSessionsText,
  pruneSessions,
  removeSessions,
  reopenSessionCommand,
} from "./commands";
import { writeLock } from "./lock";
import {
  openSession,
  readSession,
  SessionError,
  sessionDir,
  writeSession,
} from "./session";

const base = realpathSync(mkdtempSync(join(tmpdir(), "akapen-cmd-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
let n = 0;
function setup() {
  const home = join(base, `home${n}`);
  const root = join(base, `root${n++}`);
  mkdirSync(root);
  return { home, root };
}
const retention = { idleDays: 60, endedDays: 14 };

describe("session commands", () => {
  test("ls lists active sessions, or all with --all", () => {
    const { home, root } = setup();
    const old = openSession(home, root).meta;
    const current = openSession(home, root, { fresh: true }).meta;
    const active = listSessionsText(home, false);
    expect(active).toContain(current.id);
    expect(active).not.toContain(old.id);
    expect(listSessionsText(home, true)).toContain(old.id);
    expect(active.split("\n")[0]).toMatch(/^ID\s+STATUS\s+LAST ACTIVE\s+ROOT$/);
  });

  test("end takes a session id or a directory", () => {
    const { home, root } = setup();
    const first = openSession(home, root).meta;
    expect(endSessionCommand(home, first.id)).toBe(
      `Ended session ${first.id}.`,
    );
    expect(readSession(home, first.id)?.status).toBe("ended");

    const second = openSession(home, root).meta;
    expect(endSessionCommand(home, root)).toBe(`Ended session ${second.id}.`);
    expect(() => endSessionCommand(home, root)).toThrow(SessionError);
  });

  test("reopen refuses when the root already has an active session", () => {
    const { home, root } = setup();
    const old = openSession(home, root).meta;
    const current = openSession(home, root, { fresh: true }).meta;
    expect(() => reopenSessionCommand(home, old.id)).toThrow(
      `Session ${current.id} is already active for ${root}`,
    );
    endSessionCommand(home, current.id);
    expect(reopenSessionCommand(home, old.id)).toBe(
      `Reopened session ${old.id}.`,
    );
    expect(readSession(home, old.id)).toMatchObject({
      status: "active",
      endedAt: null,
    });
  });

  test("rm deletes sessions but refuses running ones", () => {
    const { home, root } = setup();
    const meta = openSession(home, root).meta;
    writeLock(sessionDir(home, meta.id), {
      pid: process.pid,
      host: "127.0.0.1",
      port: 1,
      url: "http://127.0.0.1:1/",
      startedAt: meta.createdAt,
    });
    expect(() => removeSessions(home, [meta.id])).toThrow("is running");
    rmSync(join(sessionDir(home, meta.id), "server.lock"));
    expect(removeSessions(home, [meta.id])).toBe(`Removed session ${meta.id}.`);
    expect(existsSync(sessionDir(home, meta.id))).toBe(false);
    expect(() => removeSessions(home, ["nope"])).toThrow(
      "Session not found: nope",
    );
  });

  test("prune reports, and only changes things without --dry-run", () => {
    const { home, root } = setup();
    const meta = openSession(home, root).meta;
    writeSession(home, {
      ...meta,
      status: "ended",
      endedAt: "2020-01-01T00:00:00+00:00",
    });
    const dry = pruneSessions(home, retention, true);
    expect(dry).toContain(`Would remove ${meta.id}`);
    expect(existsSync(sessionDir(home, meta.id))).toBe(true);
    const done = pruneSessions(home, retention, false);
    expect(done).toContain(`Removed ${meta.id}`);
    expect(existsSync(sessionDir(home, meta.id))).toBe(false);
    expect(pruneSessions(home, retention, false)).toBe("Nothing to prune.");
  });
});
