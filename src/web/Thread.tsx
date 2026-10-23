import { useState } from "react";
import type { Comment, Thread } from "../shared/api";
import {
  addComment,
  deleteComment,
  editComment,
  reopenThread,
  resolveThread,
} from "./api";
import { Composer } from "./Composer";
import { useReviewer } from "./context";
import { threadStore } from "./store";
import { linkify, relativeTime } from "./text";

export function lineRange(thread: Pick<Thread, "startLine" | "endLine">) {
  return thread.startLine === thread.endLine
    ? `Line ${thread.startLine}`
    : `Lines ${thread.startLine}–${thread.endLine}`;
}

export function ThreadView({ thread }: { thread: Thread }) {
  const reviewer = useReviewer();
  const resolved = thread.status === "resolved";
  const [expanded, setExpanded] = useState(!resolved);
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = (action: () => Promise<void>) => {
    setError(null);
    action().catch((e: Error) => setError(e.message));
  };

  return (
    <div
      className="thread"
      data-thread-id={thread.id}
      data-status={thread.status}
    >
      <button
        className="thread-header"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span>{lineRange(thread)}</span>
        {resolved && <span className="label">Resolved</span>}
        {thread.outdated && <span className="label">Outdated</span>}
        {thread.exportedAt && <span className="label">Sent</span>}
        {!expanded && (
          <span className="muted">
            {thread.comments[0]?.author}: {thread.comments[0]?.body}
          </span>
        )}
      </button>
      {expanded && (
        <>
          {thread.comments.map((comment) => (
            <CommentView key={comment.id} comment={comment} />
          ))}
          {error && <p className="composer-error">{error}</p>}
          {!reviewer.readOnly &&
            (replying ? (
              <Composer
                submitLabel="Reply"
                placeholder="Reply"
                onCancel={() => setReplying(false)}
                onSubmit={async (body) => {
                  threadStore.upsert(
                    await addComment(thread.id, {
                      author: reviewer.nickname,
                      clientId: reviewer.clientId,
                      body,
                    }),
                  );
                  setReplying(false);
                }}
              />
            ) : (
              <div className="thread-actions">
                <button data-action="reply" onClick={() => setReplying(true)}>
                  Reply
                </button>
                {resolved ? (
                  <button
                    data-action="reopen"
                    onClick={() =>
                      act(async () =>
                        threadStore.upsert(await reopenThread(thread.id)),
                      )
                    }
                  >
                    Reopen
                  </button>
                ) : (
                  <button
                    data-action="resolve"
                    onClick={() =>
                      act(async () => {
                        threadStore.upsert(
                          await resolveThread(thread.id, reviewer.nickname),
                        );
                        setExpanded(false);
                      })
                    }
                  >
                    Resolve
                  </button>
                )}
              </div>
            ))}
        </>
      )}
    </div>
  );
}

function CommentView({ comment }: { comment: Comment }) {
  const reviewer = useReviewer();
  const mine = comment.clientId === reviewer.clientId && !reviewer.readOnly;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <Composer
        submitLabel="Save"
        initial={comment.body}
        onCancel={() => setEditing(false)}
        onSubmit={async (body) => {
          threadStore.upsert(
            await editComment(comment.id, reviewer.clientId, body),
          );
          setEditing(false);
        }}
      />
    );
  }

  const remove = async () => {
    setConfirming(false);
    try {
      const result = await deleteComment(comment.id, reviewer.clientId);
      if ("thread" in result) threadStore.upsert(result.thread);
      else threadStore.remove(result.deletedThreadId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="comment" data-comment-id={comment.id}>
      <div className="comment-meta">
        <strong>{comment.author}</strong>
        <time
          dateTime={comment.createdAt}
          title={new Date(comment.createdAt).toLocaleString()}
        >
          {relativeTime(comment.createdAt)}
        </time>
        {comment.updatedAt && <span className="muted">(edited)</span>}
        {mine && (
          <span className="comment-actions">
            <button data-action="edit" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              data-action="delete"
              onClick={() => (confirming ? void remove() : setConfirming(true))}
              onBlur={() => setConfirming(false)}
            >
              {confirming ? "Delete?" : "Delete"}
            </button>
          </span>
        )}
      </div>
      <div className="comment-body">{linkify(comment.body)}</div>
      {error && <p className="composer-error">{error}</p>}
    </div>
  );
}
