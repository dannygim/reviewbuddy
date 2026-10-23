import type { Database } from "bun:sqlite";
import type { Comment, Thread } from "../shared/api";
import { ulid } from "./ulid";

export class ReviewError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export type CommentInput = { author: string; clientId: string; body: string };

export type ThreadInput = CommentInput & {
  path: string;
  startLine: number;
  endLine: number;
  anchorText: string;
  fileSha: string;
  originView: Thread["originView"];
};

type ThreadRow = {
  id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  anchor_text: string;
  origin_view: Thread["originView"];
  status: Thread["status"];
  outdated: number;
  created_by: string;
  created_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  exported_at: string | null;
};

type CommentRow = {
  id: string;
  thread_id: string;
  author: string;
  client_id: string;
  body: string;
  created_at: string;
  updated_at: string | null;
};

const toComment = (row: CommentRow): Comment => ({
  id: row.id,
  threadId: row.thread_id,
  author: row.author,
  clientId: row.client_id,
  body: row.body,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class ReviewStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private timestamp(): string {
    return this.now().toISOString();
  }

  listThreads(path?: string): Thread[] {
    const rows = (
      path === undefined
        ? this.db
            .query("SELECT * FROM threads ORDER BY file_path, start_line, id")
            .all()
        : this.db
            .query(
              "SELECT * FROM threads WHERE file_path = $path ORDER BY start_line, id",
            )
            .all({ path })
    ) as ThreadRow[];
    const comments = new Map<string, Comment[]>();
    for (const row of this.db
      .query("SELECT * FROM comments ORDER BY id")
      .all() as CommentRow[]) {
      const list = comments.get(row.thread_id) ?? [];
      list.push(toComment(row));
      comments.set(row.thread_id, list);
    }
    return rows.map((row) => this.toThread(row, comments.get(row.id) ?? []));
  }

  getThread(id: string): Thread {
    const row = this.db
      .query("SELECT * FROM threads WHERE id = $id")
      .get({ id }) as ThreadRow | null;
    if (!row) throw new ReviewError(404, "Thread not found");
    const comments = this.db
      .query("SELECT * FROM comments WHERE thread_id = $id ORDER BY id")
      .all({ id }) as CommentRow[];
    return this.toThread(row, comments.map(toComment));
  }

  createThread(input: ThreadInput): Thread {
    const id = ulid();
    const now = this.timestamp();
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO threads (id, file_path, start_line, end_line, anchor_text, file_sha, origin_view, created_by, created_at)
           VALUES ($id, $path, $start, $end, $anchor, $sha, $view, $author, $now)`,
        )
        .run({
          id,
          path: input.path,
          start: input.startLine,
          end: input.endLine,
          anchor: input.anchorText,
          sha: input.fileSha,
          view: input.originView,
          author: input.author,
          now,
        });
      this.insertComment(id, input, now);
    })();
    return this.getThread(id);
  }

  addComment(threadId: string, input: CommentInput): Thread {
    this.getThread(threadId);
    this.insertComment(threadId, input, this.timestamp());
    return this.getThread(threadId);
  }

  editComment(id: string, clientId: string, body: string): Thread {
    const comment = this.ownComment(id, clientId);
    this.db
      .query(
        "UPDATE comments SET body = $body, updated_at = $now WHERE id = $id",
      )
      .run({ id, body, now: this.timestamp() });
    return this.getThread(comment.thread_id);
  }

  /**
   * Deletes a reply, or the whole thread when deleting its first comment.
   * A first comment with replies cannot be deleted.
   */
  deleteComment(
    id: string,
    clientId: string,
  ): { thread: Thread } | { deletedThreadId: string } {
    const comment = this.ownComment(id, clientId);
    const threadId = comment.thread_id;
    const ids = (
      this.db
        .query(
          "SELECT id FROM comments WHERE thread_id = $threadId ORDER BY id",
        )
        .all({ threadId }) as { id: string }[]
    ).map((row) => row.id);
    if (ids[0] !== id) {
      this.db.query("DELETE FROM comments WHERE id = $id").run({ id });
      return { thread: this.getThread(threadId) };
    }
    if (ids.length > 1) {
      throw new ReviewError(409, "A comment with replies cannot be deleted");
    }
    this.db.query("DELETE FROM threads WHERE id = $threadId").run({ threadId });
    return { deletedThreadId: threadId };
  }

  /** Records that the threads were copied as a prompt (the "Sent" badge). */
  markExported(ids: string[]): Thread[] {
    for (const id of ids) this.getThread(id);
    const now = this.timestamp();
    this.db.transaction(() => {
      for (const id of ids) {
        this.db
          .query("UPDATE threads SET exported_at = $now WHERE id = $id")
          .run({ id, now });
      }
    })();
    return ids.map((id) => this.getThread(id));
  }

  resolve(id: string, by: string): Thread {
    this.getThread(id);
    this.db
      .query(
        "UPDATE threads SET status = 'resolved', resolved_by = $by, resolved_at = $now WHERE id = $id",
      )
      .run({ id, by, now: this.timestamp() });
    return this.getThread(id);
  }

  reopen(id: string): Thread {
    this.getThread(id);
    this.db
      .query(
        "UPDATE threads SET status = 'open', resolved_by = NULL, resolved_at = NULL WHERE id = $id",
      )
      .run({ id });
    return this.getThread(id);
  }

  private insertComment(threadId: string, input: CommentInput, now: string) {
    this.db
      .query(
        `INSERT INTO comments (id, thread_id, author, client_id, body, created_at)
         VALUES ($id, $threadId, $author, $clientId, $body, $now)`,
      )
      .run({
        id: ulid(),
        threadId,
        author: input.author,
        clientId: input.clientId,
        body: input.body,
        now,
      });
  }

  private ownComment(id: string, clientId: string): CommentRow {
    const row = this.db
      .query("SELECT * FROM comments WHERE id = $id")
      .get({ id }) as CommentRow | null;
    if (!row) throw new ReviewError(404, "Comment not found");
    if (row.client_id !== clientId) {
      throw new ReviewError(403, "Only the author can change this comment");
    }
    return row;
  }

  private toThread(row: ThreadRow, comments: Comment[]): Thread {
    return {
      id: row.id,
      path: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      anchorText: row.anchor_text,
      originView: row.origin_view,
      status: row.status,
      outdated: row.outdated === 1,
      createdBy: row.created_by,
      createdAt: row.created_at,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      exportedAt: row.exported_at,
      comments,
    };
  }
}
