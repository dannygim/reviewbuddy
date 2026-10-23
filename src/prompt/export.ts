import { join } from "node:path";
import type { ExportFormat, ExportStatus } from "../args";
import { openReviewDb } from "../review/db";
import { ReviewStore } from "../review/store";
import {
  listSessions,
  readSession,
  SessionError,
  type SessionMeta,
  sessionDir,
} from "../session/session";
import {
  DEFAULT_PROMPT_OPTIONS,
  formatJsonl,
  formatPrompt,
  type PromptOptions,
} from "./format";

/** The session to export: the given id, or the root's active session. */
export function findExportSession(
  home: string,
  target: { sessionId?: string; root?: string },
): SessionMeta {
  if (target.sessionId) {
    const meta = readSession(home, target.sessionId);
    if (!meta) throw new SessionError(`Session not found: ${target.sessionId}`);
    return meta;
  }
  const meta = listSessions(home).find(
    (m) => m.status === "active" && m.root === target.root,
  );
  if (!meta) {
    throw new SessionError(
      `No active session for ${target.root}. Use --session <id> for an ended one (see akapen session ls).`,
    );
  }
  return meta;
}

/** Reads the session's threads (without recording an export) and formats them. */
export function exportThreads(
  home: string,
  meta: SessionMeta,
  options: {
    status: ExportStatus;
    format: ExportFormat;
    prompt?: PromptOptions;
  },
): string {
  const db = openReviewDb(join(sessionDir(home, meta.id), "review.db"));
  try {
    const threads = new ReviewStore(db)
      .listThreads()
      .filter((t) => options.status === "all" || t.status === options.status);
    return options.format === "jsonl"
      ? formatJsonl(threads)
      : formatPrompt(threads, options.prompt ?? DEFAULT_PROMPT_OPTIONS);
  } finally {
    db.close();
  }
}
