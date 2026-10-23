import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { VERSION } from "../version";
import { ensurePrivateDir, ensureSessionsDir, writePrivateFile } from "./home";

export type SessionMeta = {
  schemaVersion: 1;
  id: string;
  /** Real path of the reviewed directory. */
  root: string;
  status: "active" | "ended";
  createdAt: string;
  lastActiveAt: string;
  endedAt: string | null;
  appVersion: string;
};

export class SessionError extends Error {}

const TOUCH_INTERVAL_MS = 60_000;

export function sessionDir(home: string, id: string): string {
  return join(home, "sessions", id);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO 8601 in local time with the offset, e.g. 2026-10-23T15:30:12+09:00. */
export function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function newSessionId(
  root: string,
  now: Date,
  random: () => number = Math.random,
): string {
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const name =
    basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .slice(0, 32)
      .replace(/^-+|-+$/g, "") || "root";
  const suffix = Math.floor(random() * 0x10000)
    .toString(16)
    .padStart(4, "0");
  return `${stamp}-${name}-${suffix}`;
}

export function readSession(home: string, id: string): SessionMeta | null {
  try {
    const meta = JSON.parse(
      readFileSync(join(sessionDir(home, id), "session.json"), "utf8"),
    ) as SessionMeta;
    return meta.schemaVersion === 1 && meta.id === id ? meta : null;
  } catch {
    return null;
  }
}

export function writeSession(home: string, meta: SessionMeta): void {
  writePrivateFile(
    join(sessionDir(home, meta.id), "session.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
}

/** All readable sessions, newest first. */
export function listSessions(home: string): SessionMeta[] {
  const dir = join(home, "sessions");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readSession(home, entry.name))
    .filter((meta) => meta !== null)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export type OpenOptions = {
  /** End the root's active session and start a new one (--new). */
  fresh?: boolean;
  /** Open this session instead of the root's active one (--session). */
  id?: string;
};

export function openSession(
  home: string,
  root: string,
  options: OpenOptions = {},
  now: Date = new Date(),
): { meta: SessionMeta; readOnly: boolean } {
  ensureSessionsDir(home);
  if (options.id) {
    const meta = readSession(home, options.id);
    if (!meta) throw new SessionError(`Session not found: ${options.id}`);
    return { meta, readOnly: meta.status === "ended" };
  }

  const active = listSessions(home).filter(
    (meta) => meta.status === "active" && meta.root === root,
  );
  if (active[0] && !options.fresh) return { meta: active[0], readOnly: false };
  for (const meta of active) {
    writeSession(home, { ...meta, status: "ended", endedAt: localIso(now) });
  }

  let id = newSessionId(root, now);
  while (existsSync(sessionDir(home, id))) id = newSessionId(root, now);
  const meta: SessionMeta = {
    schemaVersion: 1,
    id,
    root,
    status: "active",
    createdAt: localIso(now),
    lastActiveAt: localIso(now),
    endedAt: null,
    appVersion: VERSION,
  };
  ensurePrivateDir(sessionDir(home, id));
  writeSession(home, meta);
  return { meta, readOnly: false };
}

/** Records activity, at most once a minute. Returns the (possibly updated) meta. */
export function touchSession(
  home: string,
  meta: SessionMeta,
  now: Date = new Date(),
): SessionMeta {
  if (now.getTime() - Date.parse(meta.lastActiveAt) < TOUCH_INTERVAL_MS) {
    return meta;
  }
  const next = { ...meta, lastActiveAt: localIso(now) };
  writeSession(home, next);
  return next;
}
