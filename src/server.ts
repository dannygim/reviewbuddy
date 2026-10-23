import type { FileIndex } from "./files/file-index";
import { resolveFile } from "./files/resolve";
import { errorResponse, type Handler } from "./http";
import { isImagePath, renderFile } from "./render/file-view";
import { type Body, InputError } from "./review/input";
import { reviewRoutes } from "./review/routes";
import { ReviewError, type ReviewStore } from "./review/store";
import { isAllowedHost } from "./security";
import type { SessionMeta } from "./session/session";
import type { Health, SessionInfo, TreeResponse } from "./shared/api";
import { VERSION } from "./version";
import index from "./web/index.html";

export type SessionContext = {
  meta: SessionMeta;
  readOnly: boolean;
  /** Required in X-Akapen-Token on every write. */
  token: string;
  store: ReviewStore;
  /** Records activity; called after each successful write. */
  touch(): void;
};

export type ServerOptions = {
  root: string;
  host: string;
  port: number;
  strictPort: boolean;
  index: FileIndex;
  allowedHosts: string[];
  maxHighlightBytes: number;
  session: SessionContext;
};

const PORT_ATTEMPTS = 20;
const RAW_HEADERS = {
  // A raw SVG opened directly must not run scripts in our origin.
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "X-Content-Type-Options": "nosniff",
};

export function startServer(options: ServerOptions): Bun.Server<undefined> {
  const attempts = options.strictPort ? 1 : PORT_ATTEMPTS;
  for (let i = 0; ; i++) {
    try {
      return listen(options, options.port + i);
    } catch (error) {
      if (
        i + 1 >= attempts ||
        (error as { code?: string }).code !== "EADDRINUSE"
      )
        throw error;
    }
  }
}

function listen(options: ServerOptions, port: number): Bun.Server<undefined> {
  const { root, index: files, session } = options;
  const health: Health = {
    name: "akapen",
    version: VERSION,
    root,
    sessionId: session.meta.id,
  };

  // Against DNS rebinding (docs/design/セキュリティ.md).
  const guard =
    (handler: Handler): Handler =>
    (req) =>
      isAllowedHost(req.headers.get("host"), options.allowedHosts)
        ? handler(req)
        : errorResponse(403, "Host not allowed");

  // Against CSRF: the token and the JSON content type both require a
  // same-origin page, since other origins cannot read the token or send them.
  const write = (
    handler: (req: Request, body: Body) => Response | Promise<Response>,
  ): Handler =>
    guard(async (req) => {
      if (req.headers.get("x-akapen-token") !== session.token) {
        return errorResponse(403, "Missing or invalid token");
      }
      if (!req.headers.get("content-type")?.includes("application/json")) {
        return errorResponse(415, "Expected application/json");
      }
      if (session.readOnly) {
        return errorResponse(409, "This session has ended and is read-only");
      }
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return errorResponse(400, "Invalid JSON");
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return errorResponse(400, "Expected a JSON object");
      }
      try {
        const res = await handler(req, body as Body);
        session.touch();
        return res;
      } catch (error) {
        if (error instanceof ReviewError) {
          return errorResponse(error.status, error.message);
        }
        if (error instanceof InputError)
          return errorResponse(400, error.message);
        throw error;
      }
    });

  const fileFrom = (req: Request) => {
    const path = new URL(req.url).searchParams.get("path") ?? "";
    return { path, abs: resolveFile(root, files, path) };
  };

  return Bun.serve({
    hostname: options.host,
    port,
    // `bun build --compile` implies --production, which inlines NODE_ENV=production.
    development: process.env.NODE_ENV !== "production",
    routes: {
      "/": index,
      "/api/health": guard(() => Response.json(health)),
      "/api/session": guard(() =>
        Response.json({
          id: session.meta.id,
          root,
          status: session.meta.status,
          readOnly: session.readOnly,
          token: session.token,
        } satisfies SessionInfo),
      ),
      "/api/tree": guard(() =>
        Response.json({ files: files.paths() } satisfies TreeResponse),
      ),
      "/api/file": guard(async (req) => {
        const { path, abs } = fileFrom(req);
        if (!abs) return errorResponse(404, "File not found");
        return Response.json(
          await renderFile(abs, path, {
            maxHighlightBytes: options.maxHighlightBytes,
            isListed: (p) => files.has(p),
          }),
        );
      }),
      "/api/raw": guard((req) => {
        const { path, abs } = fileFrom(req);
        if (!abs || !isImagePath(path))
          return errorResponse(404, "File not found");
        return new Response(Bun.file(abs), { headers: RAW_HEADERS });
      }),
      ...reviewRoutes({ root, files, store: session.store, guard, write }),
    },
    fetch: guard(() => errorResponse(404, "Not found")),
  });
}
