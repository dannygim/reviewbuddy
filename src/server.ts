import type { FileIndex } from "./files/file-index";
import { resolveFile } from "./files/resolve";
import { errorResponse, type Handler } from "./http";
import { DEFAULT_PROMPT_OPTIONS, type PromptOptions } from "./prompt/format";
import { Hub, type SocketData } from "./realtime/hub";
import { isImagePath, renderFile } from "./render/file-view";
import { type Body, InputError } from "./review/input";
import { reviewRoutes } from "./review/routes";
import { ReviewError, type ReviewStore } from "./review/store";
import { isAllowedHost, isAllowedOrigin } from "./security";
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
  /** Defaults to an empty preamble and 30 anchor lines. */
  prompt?: PromptOptions;
  /** Default of "Resolve copied threads" in the Review panel. */
  resolveOnCopy?: boolean;
};

export type AppServer = Bun.Server<SocketData>;

const PORT_ATTEMPTS = 20;
const RAW_HEADERS = {
  // A raw SVG opened directly must not run scripts in our origin.
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "X-Content-Type-Options": "nosniff",
};

export function startServer(options: ServerOptions): AppServer {
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

function listen(options: ServerOptions, port: number): AppServer {
  const { root, index: files, session } = options;
  const hub = new Hub();
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

  const server = Bun.serve({
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
          resolveOnCopy: options.resolveOnCopy ?? false,
          prompt: options.prompt ?? DEFAULT_PROMPT_OPTIONS,
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
      ...reviewRoutes({
        root,
        files,
        store: session.store,
        guard,
        write,
        publish: (event) => hub.publish(event),
        prompt: options.prompt ?? DEFAULT_PROMPT_OPTIONS,
      }),
    },
    fetch(req, server) {
      if (!isAllowedHost(req.headers.get("host"), options.allowedHosts)) {
        return errorResponse(403, "Host not allowed");
      }
      const url = new URL(req.url);
      if (url.pathname !== "/ws") return errorResponse(404, "Not found");
      // Same rules as writes: the token proves the page is ours.
      if (url.searchParams.get("token") !== session.token) {
        return errorResponse(403, "Missing or invalid token");
      }
      if (
        !isAllowedOrigin(req.headers.get("origin"), req.headers.get("host"))
      ) {
        return errorResponse(403, "Origin not allowed");
      }
      const data: SocketData = { clientId: null, nickname: null, path: null };
      if (server.upgrade(req, { data })) {
        session.touch();
        return undefined;
      }
      return errorResponse(400, "Expected a WebSocket upgrade");
    },
    websocket: hub.handlers,
  });
  hub.attach(server);
  return server;
}
