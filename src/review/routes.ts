import type { FileIndex } from "../files/file-index";
import { resolveFile } from "../files/resolve";
import { type Handler, param } from "../http";
import { isImagePath } from "../render/file-view";
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
}) {
  const { root, files, store, guard, write } = deps;
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
        return Response.json(thread, { status: 201 });
      }),
    },
    "/api/threads/:id/comments": {
      POST: write((req, body) =>
        Response.json(store.addComment(param(req, "id"), comment(body)), {
          status: 201,
        }),
      ),
    },
    "/api/comments/:id": {
      PATCH: write((req, body) =>
        Response.json(
          store.editComment(
            param(req, "id"),
            text(body, "clientId", MAX_CLIENT_ID),
            text(body, "body", MAX_BODY),
          ),
        ),
      ),
      DELETE: write((req, body) =>
        Response.json(
          store.deleteComment(
            param(req, "id"),
            text(body, "clientId", MAX_CLIENT_ID),
          ),
        ),
      ),
    },
    "/api/threads/:id/resolve": {
      POST: write((req, body) =>
        Response.json(
          store.resolve(param(req, "id"), text(body, "author", MAX_AUTHOR)),
        ),
      ),
    },
    "/api/threads/:id/reopen": {
      POST: write((req) => Response.json(store.reopen(param(req, "id")))),
    },
  };
}
