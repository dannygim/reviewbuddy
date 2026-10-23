import { existsSync, realpathSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyPrune,
  formatMegabytes,
  isSessionRunning,
  planPrune,
  type Retention,
} from "./retention";
import {
  listSessions,
  localIso,
  readSession,
  SessionError,
  type SessionMeta,
  sessionDir,
  writeSession,
} from "./session";

// `akapen session ...` (docs/design/CLI_仕様.md). Each returns what to print.

export function listSessionsText(home: string, all: boolean): string {
  const sessions = listSessions(home).filter(
    (m) => all || m.status === "active",
  );
  if (sessions.length === 0)
    return all ? "No sessions." : "No active sessions.";
  const rows = [
    ["ID", "STATUS", "LAST ACTIVE", "ROOT"],
    ...sessions.map((m) => [
      m.id,
      isSessionRunning(home, m) ? `${m.status} (running)` : m.status,
      m.lastActiveAt,
      m.root,
    ]),
  ];
  const widths = rows[0]!.map((_, i) =>
    Math.max(...rows.map((r) => r[i]!.length)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, i) =>
          i === row.length - 1 ? cell : cell.padEnd(widths[i]!),
        )
        .join("  "),
    )
    .join("\n");
}

/** A session id, or a directory whose active session to use. */
function findTarget(home: string, target: string): SessionMeta {
  const byId = readSession(home, target);
  if (byId) return byId;
  const dir = resolve(target);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new SessionError(`Session not found: ${target}`);
  }
  const root = realpathSync(dir);
  const active = listSessions(home).find(
    (m) => m.status === "active" && m.root === root,
  );
  if (!active) throw new SessionError(`No active session for ${root}`);
  return active;
}

export function endSessionCommand(
  home: string,
  target: string,
  now = new Date(),
): string {
  const meta = findTarget(home, target);
  if (meta.status === "ended")
    throw new SessionError(`Session ${meta.id} has already ended`);
  writeSession(home, { ...meta, status: "ended", endedAt: localIso(now) });
  return `Ended session ${meta.id}.`;
}

export function reopenSessionCommand(
  home: string,
  id: string,
  now = new Date(),
): string {
  const meta = readSession(home, id);
  if (!meta) throw new SessionError(`Session not found: ${id}`);
  if (meta.status === "active")
    throw new SessionError(`Session ${id} is already active`);
  const other = listSessions(home).find(
    (m) => m.status === "active" && m.root === meta.root,
  );
  if (other) {
    throw new SessionError(
      `Session ${other.id} is already active for ${meta.root}`,
    );
  }
  writeSession(home, {
    ...meta,
    status: "active",
    endedAt: null,
    lastActiveAt: localIso(now),
  });
  return `Reopened session ${id}.`;
}

export function removeSessions(home: string, ids: string[]): string {
  const sessions = ids.map((id) => {
    const meta = readSession(home, id);
    if (!meta) throw new SessionError(`Session not found: ${id}`);
    if (isSessionRunning(home, meta)) {
      throw new SessionError(`Session ${id} is running; stop the server first`);
    }
    return meta;
  });
  for (const meta of sessions) {
    rmSync(sessionDir(home, meta.id), { recursive: true, force: true });
  }
  return sessions.map((m) => `Removed session ${m.id}.`).join("\n");
}

function plan(home: string, retention: Retention, now: Date) {
  return planPrune(listSessions(home), now, retention, {
    isRunning: (meta) => isSessionRunning(home, meta),
    rootExists: (meta) => existsSync(meta.root),
  });
}

export function pruneSessions(
  home: string,
  retention: Retention,
  dryRun: boolean,
  now = new Date(),
): string {
  const todo = plan(home, retention, now);
  if (todo.end.length === 0 && todo.remove.length === 0)
    return "Nothing to prune.";
  const lines = [
    ...todo.end.map(
      (m) => `${dryRun ? "Would end" : "Ended"} ${m.id} (${m.root})`,
    ),
    ...todo.remove.map(
      (m) => `${dryRun ? "Would remove" : "Removed"} ${m.id} (${m.root})`,
    ),
  ];
  if (!dryRun) {
    const freed = applyPrune(home, todo, now);
    if (todo.remove.length > 0) lines.push(`Freed ${formatMegabytes(freed)}.`);
  }
  return lines.join("\n");
}

/** The automatic pass at startup; returns a one-line summary, or null. */
export function autoPrune(
  home: string,
  retention: Retention,
  now = new Date(),
): string | null {
  const todo = plan(home, retention, now);
  if (todo.end.length === 0 && todo.remove.length === 0) return null;
  const freed = applyPrune(home, todo, now);
  const parts: string[] = [];
  if (todo.end.length > 0)
    parts.push(
      `ended ${todo.end.length} idle session${todo.end.length === 1 ? "" : "s"}`,
    );
  if (todo.remove.length > 0) {
    parts.push(
      `pruned ${todo.remove.length} ended session${todo.remove.length === 1 ? "" : "s"} (${formatMegabytes(freed)})`,
    );
  }
  const text = parts.join(", ");
  return text[0]!.toUpperCase() + text.slice(1);
}
