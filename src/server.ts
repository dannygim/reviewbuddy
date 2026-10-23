import type { FileIndex } from "./files/file-index";
import { resolveFile } from "./files/resolve";
import { isImagePath, renderFile } from "./render/file-view";
import { isAllowedHost } from "./security";
import type { Health, TreeResponse } from "./shared/api";
import { VERSION } from "./version";
import index from "./web/index.html";

export type ServerOptions = {
  root: string;
  host: string;
  port: number;
  strictPort: boolean;
  index: FileIndex;
  allowedHosts: string[];
  maxHighlightBytes: number;
};

type Handler = (req: Request) => Response | Promise<Response>;

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

function errorResponse(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function listen(options: ServerOptions, port: number): Bun.Server<undefined> {
  const { root, index: files } = options;
  const health: Health = { name: "akapen", version: VERSION, root };

  const guard =
    (handler: Handler): Handler =>
    (req) =>
      isAllowedHost(req.headers.get("host"), options.allowedHosts)
        ? handler(req)
        : errorResponse(403, "Host not allowed");

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
      "/api/tree": guard(() =>
        Response.json({ files: files.paths() } satisfies TreeResponse),
      ),
      "/api/file": guard(async (req) => {
        const { path, abs } = fileFrom(req);
        if (!abs) return errorResponse(404, "File not found");
        return Response.json(
          await renderFile(abs, path, {
            maxHighlightBytes: options.maxHighlightBytes,
          }),
        );
      }),
      "/api/raw": guard((req) => {
        const { path, abs } = fileFrom(req);
        if (!abs || !isImagePath(path))
          return errorResponse(404, "File not found");
        return new Response(Bun.file(abs), { headers: RAW_HEADERS });
      }),
    },
    fetch: guard(() => errorResponse(404, "Not found")),
  });
}
