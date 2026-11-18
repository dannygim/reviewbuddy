import type { FileIndex } from "../files/file-index";
import { resolveFile } from "../files/resolve";
import { type Handler, param } from "../http";
import { formatPrompt, type PromptOptions } from "../prompt/format";
import { isImagePath } from "../render/file-view";
import type { PromptResponse, Thread } from "../shared/api";
import type { ServerEvent } from "../shared/events";
import { anchorFor } from "./anchor";
import { type Body, InputError, integer, oneOf, text } from "./input";
import { ReviewError, type ReviewStore } from "./store";

const MAX_BODY = 20_000;
const MAX_AUTHOR = 50;
const MAX_CLIENT_ID = 100;
const ORIGIN_VIEWS = ["source", "preview"] as const;

type WriteHandler = (req: Request, body: Body) => Response | Promise<Response>;

const comment = (body: Body) => ({
  author: text(body, "author", MAX_AUTHOR),
  clientId: text(body, "clientId", MAX_CLIENT_ID),
  body: text(body, "body", MAX_BODY),
});

/** A thread as sent to browsers: marked when it is on an ignored file. */
export const withIgnored = (files: FileIndex, thread: Thread): Thread => ({
  ...thread,
  ignored: files.isIgnoredFile(thread.path),
});

/** REST routes for threads and comments (see docs/design/API.md). */
export function reviewRoutes(deps: {
  root: string;
  files: FileIndex;
  store: ReviewStore;
  guard: (handler: Handler) => Handler;
  write: (handler: WriteHandler) => Handler;
  /** Broadcasts a change to every connected browser. */
  publish: (event: ServerEvent) => void;
  prompt: PromptOptions;
  /** Whether a request comes from the owner (docs/adr/0009-owner-by-connection.md). */
  isOwner: (req: Request) => boolean;
}) {
  const { root, files, store, guard, write, publish, isOwner } = deps;
  const sent = (thread: Thread) => withIgnored(files, thread);
  const updated = (thread: Thread, status = 200) => {
    const marked = sent(thread);
    publish({ type: "thread.updated", thread: marked });
    return Response.json(marked, { status });
  };
  // Threads on ignored files are the owner's to change; others only read them.
  const changeable = (req: Request, thread: Thread) => {
    if (!isOwner(req) && files.isIgnoredFile(thread.path)) {
      throw new ReviewError(
        403,
        "Only the owner can change threads on ignored files.",
      );
    }
    return thread.id;
  };
  return {
    "/api/threads": {
      GET: guard((req) => {
        const path = new URL(req.url).searchParams.get("path");
        return Response.json(store.listThreads(path ?? undefined).map(sent));
      }),
      POST: write(async (req, body) => {
        const path = text(body, "path", 4096);
        // For others an ignored file is unknown, as in GET /api/file.
        const abs = resolveFile(root, files, path, { ignored: isOwner(req) });
        if (!abs) throw new InputError(`Unknown file: ${path}`);
        const bytes = await Bun.file(abs).bytes();
        if (isImagePath(path) || bytes.subarray(0, 8192).includes(0)) {
          throw new InputError(`Cannot comment on a binary file: ${path}`);
        }
        const startLine = integer(body, "startLine");
        const endLine = integer(body, "endLine");
        const anchor = anchorFor(
          new TextDecoder().decode(bytes),
          startLine,
          endLine,
        );
        if (!anchor) {
          throw new InputError(
            `Lines ${startLine}-${endLine} are out of range`,
          );
        }
        const thread = sent(
          store.createThread({
            path,
            startLine,
            endLine,
            ...anchor,
            originView: oneOf(body, "originView", ORIGIN_VIEWS),
            ...comment(body),
          }),
        );
        publish({ type: "thread.created", thread });
        return Response.json(thread, { status: 201 });
      }),
    },
    "/api/threads/:id/comments": {
      POST: write((req, body) => {
        const id = changeable(req, store.getThread(param(req, "id")));
        return updated(store.addComment(id, comment(body)), 201);
      }),
    },
    "/api/comments/:id": {
      PATCH: write((req, body) => {
        const id = param(req, "id");
        changeable(req, store.getCommentThread(id));
        return updated(
          store.editComment(
            id,
            text(body, "clientId", MAX_CLIENT_ID),
            text(body, "body", MAX_BODY),
          ),
        );
      }),
      DELETE: write((req, body) => {
        const id = param(req, "id");
        changeable(req, store.getCommentThread(id));
        const deleted = store.deleteComment(
          id,
          text(body, "clientId", MAX_CLIENT_ID),
        );
        const result =
          "thread" in deleted ? { thread: sent(deleted.thread) } : deleted;
        publish(
          "thread" in result
            ? { type: "thread.updated", thread: result.thread }
            : { type: "thread.deleted", threadId: result.deletedThreadId },
        );
        return Response.json(result);
      }),
    },
    "/api/threads/:id/resolve": {
      POST: write((req, body) => {
        const id = changeable(req, store.getThread(param(req, "id")));
        return updated(store.resolve(id, text(body, "author", MAX_AUTHOR)));
      }),
    },
    "/api/threads/:id/reopen": {
      POST: write((req) => {
        const id = changeable(req, store.getThread(param(req, "id")));
        return updated(store.reopen(id));
      }),
    },
    "/api/prompt": {
      POST: write((req, body) => {
        // The owner hands prompts to the coding agent (docs/adr/0009-owner-by-connection.md).
        if (!isOwner(req)) {
          throw new ReviewError(403, "Only the owner can copy prompts.");
        }
        const ids = body.threadIds;
        if (
          !Array.isArray(ids) ||
          ids.length === 0 ||
          !ids.every((id) => typeof id === "string")
        ) {
          throw new InputError("threadIds must be a non-empty list of IDs");
        }
        const author = text(body, "author", MAX_AUTHOR);
        const prompt = formatPrompt(
          ids.map((id) => store.getThread(id)),
          deps.prompt,
        );
        let threads = store.markExported(ids);
        if (body.resolve === true) {
          threads = threads.map((t) =>
            t.status === "open" ? store.resolve(t.id, author) : t,
          );
        }
        threads = threads.map(sent);
        for (const thread of threads)
          publish({ type: "thread.updated", thread });
        return Response.json({
          text: prompt,
          threads,
        } satisfies PromptResponse);
      }),
    },
  };
}
