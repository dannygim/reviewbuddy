import type { FileIndex } from "../files/file-index";
import { resolveFile } from "../files/resolve";
import { type Handler, param } from "../http";
import { formatPrompt, type PromptOptions } from "../prompt/format";
import { isImagePath } from "../render/file-view";
import type { PromptResponse, Thread } from "../shared/api";
import type { ServerEvent } from "../shared/events";
import { anchorFor } from "./anchor";
import { type Body, InputError, integer, oneOf, text } from "./input";
import type { ReviewStore } from "./store";

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
}) {
  const { root, files, store, guard, write, publish } = deps;
  const updated = (thread: Thread, status = 200) => {
    publish({ type: "thread.updated", thread });
    return Response.json(thread, { status });
  };
  return {
    "/api/threads": {
      GET: guard((req) => {
        const path = new URL(req.url).searchParams.get("path");
        return Response.json(store.listThreads(path ?? undefined));
      }),
      POST: write(async (_req, body) => {
        const path = text(body, "path", 4096);
        const abs = resolveFile(root, files, path);
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
        const thread = store.createThread({
          path,
          startLine,
          endLine,
          ...anchor,
          originView: oneOf(body, "originView", ORIGIN_VIEWS),
          ...comment(body),
        });
        publish({ type: "thread.created", thread });
        return Response.json(thread, { status: 201 });
      }),
    },
    "/api/threads/:id/comments": {
      POST: write((req, body) =>
        updated(store.addComment(param(req, "id"), comment(body)), 201),
      ),
    },
    "/api/comments/:id": {
      PATCH: write((req, body) =>
        updated(
          store.editComment(
            param(req, "id"),
            text(body, "clientId", MAX_CLIENT_ID),
            text(body, "body", MAX_BODY),
          ),
        ),
      ),
      DELETE: write((req, body) => {
        const result = store.deleteComment(
          param(req, "id"),
          text(body, "clientId", MAX_CLIENT_ID),
        );
        publish(
          "thread" in result
            ? { type: "thread.updated", thread: result.thread }
            : { type: "thread.deleted", threadId: result.deletedThreadId },
        );
        return Response.json(result);
      }),
    },
    "/api/threads/:id/resolve": {
      POST: write((req, body) =>
        updated(
          store.resolve(param(req, "id"), text(body, "author", MAX_AUTHOR)),
        ),
      ),
    },
    "/api/threads/:id/reopen": {
      POST: write((req) => updated(store.reopen(param(req, "id")))),
    },
    "/api/prompt": {
      POST: write((_req, body) => {
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
