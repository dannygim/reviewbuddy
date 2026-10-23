import { parseArgs } from "node:util";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 4400;

export const USAGE = `Usage: akapen [dir] [options]

Options:
  -p, --port <number>    Port to listen on (default: 4400, or the next free port)
  -H, --host <address>   Address to bind (default: 127.0.0.1)
  -v, --version          Print the version
  -h, --help             Print this help`;

export type Command =
  | {
      kind: "serve";
      dir: string;
      host: string;
      port: number;
      strictPort: boolean;
    }
  | { kind: "version" }
  | { kind: "help" };

export class UsageError extends Error {}

export function parseCliArgs(argv: string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string", short: "H" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;

  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };
  if (positionals.length > 1) {
    throw new UsageError(
      `Expected at most one directory, got: ${positionals.join(" ")}`,
    );
  }
  return {
    kind: "serve",
    dir: positionals[0] ?? ".",
    host: values.host ?? DEFAULT_HOST,
    port: values.port === undefined ? DEFAULT_PORT : parsePort(values.port),
    // A port given explicitly must not silently move (e.g. `tailscale serve 4400` proxies to it).
    strictPort: values.port !== undefined,
  };
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`Invalid port: ${value}`);
  }
  return port;
}
