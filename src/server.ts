import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AccessGate, authCookie, authCookieName } from "./auth";
import type { FileIndex } from "./files/file-index";
import { resolveFile } from "./files/resolve";
import { errorResponse, type Handler } from "./http";
import { DEFAULT_PROMPT_OPTIONS, type PromptOptions } from "./prompt/format";
import { Hub, type SocketData } from "./realtime/hub";
import { isImagePath, renderFile } from "./render/file-view";
import { splitLines } from "./render/highlight";
import { type Body, InputError } from "./review/input";
import { reviewRoutes } from "./review/routes";
import { ReviewError, type ReviewStore } from "./review/store";
import { displayRoot } from "./root";
import { isAllowedHost, isAllowedOrigin } from "./security";
import type { SessionMeta } from "./session/session";
import type { Health, SessionInfo, TreeResponse } from "./shared/api";
import { VERSION } from "./version";
import { type Change, watchRoot } from "./watch/watcher";
import index from "./web/index.html";

export type SessionContext = {
  meta: SessionMeta;
  readOnly: boolean;
  /** Required in X-Reviewbuddy-Token on every write. */
  token: string;
  store: ReviewStore;
  /** Records activity; called after each successful write. */
  touch(): void;
  /** Marks the session ended in session.json. */
  end(): void;
  /** Re-reads session.json, to notice `reviewbuddy session end` from outside. */
  reload(): SessionMeta | null;
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
  /** How often to re-read session.json (default 5 s). */
  sessionPollMs?: number;
  /** Watch the root and push file.changed / tree.changed (default false). */
  watch?: boolean;
  /** Requires the PIN before anything else; without it anyone can use the server (tests). */
  access?: AccessGate;
};

export type AppServer = Bun.Server<SocketData>;

const PORT_ATTEMPTS = 20;
const NEED_PIN = "Enter the PIN shown where reviewbuddy was started.";
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
  const { root, index: files, session, access } = options;
  const hub = new Hub();
  // Open without the PIN (to find a running server), so no root path.
  const health: Health = {
    name: "reviewbuddy",
    version: VERSION,
    sessionId: session.meta.id,
  };
  // The port is known once listening (port 0 picks one).
  const cookieName = (): string => authCookieName(server.port ?? port);

  // Against DNS rebinding (docs/design/セキュリティ.md).
  const allowHost =
    (handler: Handler): Handler =>
    (req) =>
      isAllowedHost(req.headers.get("host"), options.allowedHosts)
        ? handler(req)
        : errorResponse(403, "Host not allowed");

  // Only browsers that entered the PIN (docs/adr/0007-access-pin.md).
  const authorized = (req: Request) =>
    !access || access.isAuthorized(req.headers.get("cookie"), cookieName());

  const guard = (handler: Handler): Handler =>
    allowHost((req) =>
      authorized(req) ? handler(req) : errorResponse(401, NEED_PIN),
    );

  // Against CSRF: the token and the JSON content type both require a
  // same-origin page, since other origins cannot read the token or send them.
  const write = (
    handler: (req: Request, body: Body) => Response | Promise<Response>,
  ): Handler =>
    guard(async (req) => {
      if (req.headers.get("x-reviewbuddy-token") !== session.token) {
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

  const sessionInfo = (): SessionInfo => ({
    id: session.meta.id,
    root,
    rootDisplay: displayRoot(root),
    status: session.meta.status,
    readOnly: session.readOnly,
    token: session.token,
    resolveOnCopy: options.resolveOnCopy ?? false,
    prompt: options.prompt ?? DEFAULT_PROMPT_OPTIONS,
  });

  const markEnded = () => {
    session.readOnly = true;
    hub.publish({ type: "session.ended" });
  };

  // Keep threads on their lines when files change (docs/design/データモデル.md).
  const reanchorPath = (path: string) => {
    const abs = resolveFile(root, files, path);
    let lines: string[] | null = null;
    try {
      if (abs) lines = splitLines(readFileSync(abs, "utf8"));
    } catch {
      // deleted between the event and now: the threads become outdated
    }
    for (const thread of session.store.reanchorFile(path, lines)) {
      hub.publish({ type: "thread.updated", thread });
    }
  };

  const onChange = async (change: Change) => {
    const gone = change.files.some((path) => !existsSync(join(root, path)));
    if ((change.tree || gone) && (await files.refresh())) {
      hub.publish({ type: "tree.changed" });
    }
    for (const path of change.files) {
      hub.publish({ type: "file.changed", path });
      if (!session.readOnly) reanchorPath(path);
    }
  };

  const fileFrom = (req: Request) => {
    const path = new URL(req.url).searchParams.get("path") ?? "";
    return { path, abs: resolveFile(root, files, path) };
  };

  const server: AppServer = Bun.serve({
    hostname: options.host,
    port,
    // `bun build --compile` implies --production, which inlines NODE_ENV=production.
    development: process.env.NODE_ENV !== "production",
    routes: {
      "/": index,
      "/api/health": allowHost(() => Response.json(health)),
      "/api/login": {
        POST: allowHost(async (req) => {
          if (!access) return errorResponse(404, "Not found");
          if (!req.headers.get("content-type")?.includes("application/json")) {
            return errorResponse(415, "Expected application/json");
          }
          const body = await req.json().catch(() => null);
          const result = access.login((body as { pin?: unknown } | null)?.pin);
          if (!result.ok) return errorResponse(result.status, result.error);
          return new Response(null, {
            status: 204,
            headers: { "Set-Cookie": authCookie(cookieName(), result.token) },
          });
        }),
      },
      "/api/session": guard(() => Response.json(sessionInfo())),
      "/api/session/end": {
        POST: write(() => {
          session.end();
          markEnded();
          return Response.json(sessionInfo());
        }),
      },
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
      if (!authorized(req)) return errorResponse(401, NEED_PIN);
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

  // Started only once listening succeeded (listen may be retried on another port).
  // `reviewbuddy session end` only edits session.json; notice it within seconds.
  const poll = setInterval(() => {
    if (session.readOnly) return;
    const latest = session.reload();
    if (latest?.status === "ended") {
      session.meta = latest;
      markEnded();
    }
  }, options.sessionPollMs ?? 5000);
  poll.unref();

  if (!session.readOnly) {
    for (const path of new Set(
      session.store.listThreads().map((t) => t.path),
    )) {
      reanchorPath(path);
    }
  }

  if (options.watch) {
    watchRoot(
      root,
      (path) => files.has(path),
      (change) =>
        onChange(change).catch((error) => {
          // A failed refresh must not take the server down; the next change retries.
          console.error("reviewbuddy: watching failed:", error);
        }),
    );
  }
  return server;
}
