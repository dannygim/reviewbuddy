import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openReviewDb } from "../src/review/db";
import { ReviewStore } from "../src/review/store";
import type { SessionContext } from "../src/server";

export const TEST_TOKEN = "test-token";

/** A session backed by a throwaway database, for starting test servers. */
export function testSession(
  options: { readOnly?: boolean } = {},
): SessionContext {
  const dir = mkdtempSync(join(tmpdir(), "akapen-test-session-"));
  return {
    meta: {
      schemaVersion: 1,
      id: "20261023-1530-test-0000",
      root: dir,
      status: options.readOnly ? "ended" : "active",
      createdAt: "2026-10-23T15:30:00+09:00",
      lastActiveAt: "2026-10-23T15:30:00+09:00",
      endedAt: options.readOnly ? "2026-10-23T16:00:00+09:00" : null,
      appVersion: "0.0.0",
    },
    readOnly: options.readOnly ?? false,
    token: TEST_TOKEN,
    store: new ReviewStore(openReviewDb(join(dir, "review.db"))),
    touch() {},
  };
}
