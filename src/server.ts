import index from "./web/index.html";
import type { Health } from "./shared/api";
import { VERSION } from "./version";

export type ServerOptions = {
  root: string;
  host: string;
  port: number;
  strictPort: boolean;
};

const PORT_ATTEMPTS = 20;

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
  const health: Health = {
    name: "akapen",
    version: VERSION,
    root: options.root,
  };
  return Bun.serve({
    hostname: options.host,
    port,
    // `bun build --compile` implies --production, which inlines NODE_ENV=production.
    development: process.env.NODE_ENV !== "production",
    routes: {
      "/": index,
      "/api/health": () => Response.json(health),
    },
    fetch: () => new Response("Not Found", { status: 404 }),
  });
}
