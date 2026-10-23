import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openReviewDb } from "./db";
import { ReviewError, ReviewStore } from "./store";

const base = mkdtempSync(join(tmpdir(), "akapen-review-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

let db: Database;
let store: ReviewStore;
let n = 0;
let clock = Date.UTC(2026, 9, 23, 6, 0, 0);

beforeEach(() => {
  db = openReviewDb(join(base, `review${n++}.db`));
  store = new ReviewStore(db, () => new Date((clock += 1000)));
});

const alice = { author: "Alice", clientId: "c-alice" };
const bob = { author: "Bob", clientId: "c-bob" };

function newThread(path = "doc/A.md", startLine = 3, body = "Please fix") {
  return store.createThread({
    path,
    startLine,
    endLine: startLine,
    anchorText: "## Install",
    fileSha: "abc",
    originView: "source",
    body,
    ...alice,
  });
}

function expectError(fn: () => unknown, status: ReviewError["status"]) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ReviewError);
    expect((error as ReviewError).status).toBe(status);
    return;
  }
  throw new Error("expected a ReviewError");
}

describe("openReviewDb", () => {
  test("creates the schema privately with WAL", () => {
    const path = join(base, "fresh.db");
    const fresh = openReviewDb(path);
    expect(fresh.query("PRAGMA user_version").get()).toEqual({
      user_version: 1,
    });
    expect(fresh.query("PRAGMA journal_mode").get()).toEqual({
      journal_mode: "wal",
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    fresh.close();
    // Opening again does not re-run migrations.
    openReviewDb(path).close();
  });
});

describe("ReviewStore", () => {
  test("creates a thread with its first comment", () => {
    const thread = newThread();
    expect(thread).toMatchObject({
      path: "doc/A.md",
      startLine: 3,
      endLine: 3,
      anchorText: "## Install",
      originView: "source",
      status: "open",
      outdated: false,
      createdBy: "Alice",
      resolvedBy: null,
      exportedAt: null,
      comments: [
        {
          author: "Alice",
          clientId: "c-alice",
          body: "Please fix",
          updatedAt: null,
        },
      ],
    });
    expect(thread.comments[0]!.threadId).toBe(thread.id);
    expect(store.getThread(thread.id)).toEqual(thread);
  });

  test("lists threads by path and line, optionally for one file", () => {
    const b = newThread("doc/B.md", 1);
    const a2 = newThread("doc/A.md", 9);
    const a1 = newThread("doc/A.md", 2);
    expect(store.listThreads().map((t) => t.id)).toEqual([a1.id, a2.id, b.id]);
    expect(store.listThreads("doc/B.md").map((t) => t.id)).toEqual([b.id]);
  });

  test("adds replies in order", () => {
    const thread = newThread();
    store.addComment(thread.id, { ...bob, body: "Agreed" });
    const updated = store.addComment(thread.id, { ...alice, body: "Done" });
    expect(updated.comments.map((c) => c.body)).toEqual([
      "Please fix",
      "Agreed",
      "Done",
    ]);
    expectError(() => store.addComment("missing", { ...bob, body: "x" }), 404);
  });

  test("lets only the author edit a comment", () => {
    const thread = newThread();
    const id = thread.comments[0]!.id;
    expectError(() => store.editComment(id, "c-bob", "hijack"), 403);
    const edited = store.editComment(id, "c-alice", "Please fix this");
    expect(edited.comments[0]).toMatchObject({ body: "Please fix this" });
    expect(edited.comments[0]!.updatedAt).not.toBeNull();
    expectError(() => store.editComment("missing", "c-alice", "x"), 404);
  });

  test("deletes replies, and the thread with its first comment when alone", () => {
    const thread = newThread();
    const reply = store.addComment(thread.id, { ...bob, body: "Hm" })
      .comments[1]!;
    const first = thread.comments[0]!.id;

    expectError(() => store.deleteComment(reply.id, "c-alice"), 403);
    expectError(() => store.deleteComment(first, "c-alice"), 409);
    expect(store.deleteComment(reply.id, "c-bob")).toEqual({
      thread: store.getThread(thread.id),
    });
    expect(store.deleteComment(first, "c-alice")).toEqual({
      deletedThreadId: thread.id,
    });
    expectError(() => store.getThread(thread.id), 404);
    expect(db.query("SELECT COUNT(*) AS n FROM comments").get()).toEqual({
      n: 0,
    });
  });

  test("resolves and reopens", () => {
    const thread = newThread();
    const resolved = store.resolve(thread.id, "Bob");
    expect(resolved).toMatchObject({ status: "resolved", resolvedBy: "Bob" });
    expect(resolved.resolvedAt).not.toBeNull();
    expect(store.reopen(thread.id)).toMatchObject({
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
    });
    expectError(() => store.resolve("missing", "Bob"), 404);
  });
});

describe("reanchorFile", () => {
  test("updates moved and outdated threads and returns only those", () => {
    const moved = store.createThread({
      path: "f.md",
      startLine: 2,
      endLine: 2,
      anchorText: "b",
      fileSha: "x",
      originView: "source",
      body: "on b",
      ...alice,
    });
    const gone = store.createThread({
      path: "f.md",
      startLine: 3,
      endLine: 3,
      anchorText: "c",
      fileSha: "x",
      originView: "source",
      body: "on c",
      ...alice,
    });
    const same = store.createThread({
      path: "f.md",
      startLine: 1,
      endLine: 1,
      anchorText: "a",
      fileSha: "x",
      originView: "source",
      body: "on a",
      ...alice,
    });
    const changed = store.reanchorFile("f.md", ["a", "new", "b"]);
    expect(changed.map((t) => t.id).sort()).toEqual([gone.id, moved.id].sort());
    expect(store.getThread(moved.id)).toMatchObject({
      startLine: 3,
      endLine: 3,
      outdated: false,
    });
    expect(store.getThread(gone.id)).toMatchObject({
      startLine: 3,
      outdated: true,
    });
    expect(store.getThread(same.id)).toMatchObject({
      startLine: 1,
      outdated: false,
    });
    expect(store.reanchorFile("f.md", ["a", "new", "b"])).toEqual([]);
  });
});
