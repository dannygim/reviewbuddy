import { parseArgs } from "node:util";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 4400;

export const USAGE = `Usage: akapen [dir] [options]
       akapen export [dir] [--session <id>] [--status open|resolved|all] [--format prompt|jsonl]

Options:
  -p, --port <number>    Port to listen on (default: 4400, or the next free port)
  -H, --host <address>   Address to bind (default: 127.0.0.1)
      --new              End this directory's active session and start a new one
      --session <id>     Open a session by id (read-only once it has ended)
  -v, --version          Print the version
  -h, --help             Print this help`;

export type Command =
  | {
      kind: "serve";
      dir: string;
      host: string;
      port: number;
      strictPort: boolean;
      /** --new: end the active session and start a new one. */
      fresh: boolean;
      /** --session: open this session (its root replaces dir). */
      sessionId?: string;
    }
  | {
      kind: "export";
      dir: string;
      sessionId?: string;
      status: ExportStatus;
      format: ExportFormat;
    }
  | { kind: "version" }
  | { kind: "help" };

export type ExportStatus = "open" | "resolved" | "all";
export type ExportFormat = "prompt" | "jsonl";
const STATUSES: ExportStatus[] = ["open", "resolved", "all"];
const FORMATS: ExportFormat[] = ["prompt", "jsonl"];

export class UsageError extends Error {}

function oneOf<T extends string>(flag: string, value: string, allowed: T[]): T {
  if (!allowed.includes(value as T)) {
    throw new UsageError(
      `Invalid ${flag}: ${value} (expected ${allowed.join(", ")})`,
    );
  }
  return value as T;
}

function parseExport(argv: string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        session: { type: "string" },
        status: { type: "string" },
        format: { type: "string" },
      },
      allowPositionals: true,
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;
  const session = values.session;
  if (session !== undefined && positionals.length > 0) {
    throw new UsageError("--session cannot be combined with a directory");
  }
  if (positionals.length > 1) {
    throw new UsageError(
      `Expected at most one directory, got: ${positionals.join(" ")}`,
    );
  }
  return {
    kind: "export",
    dir: positionals[0] ?? ".",
    ...(session !== undefined && { sessionId: session }),
    status: oneOf("--status", values.status ?? "open", STATUSES),
    format: oneOf("--format", values.format ?? "prompt", FORMATS),
  };
}

export function parseCliArgs(argv: string[]): Command {
  // A directory with a subcommand's name can still be opened as ./export.
  if (argv[0] === "export") return parseExport(argv.slice(1));
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string", short: "H" },
        new: { type: "boolean" },
        session: { type: "string" },
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
  if (values.session !== undefined && positionals.length > 0) {
    throw new UsageError("--session cannot be combined with a directory");
  }
  if (values.session !== undefined && values.new) {
    throw new UsageError("--session cannot be combined with --new");
  }
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
    fresh: values.new ?? false,
    sessionId: values.session,
  };
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`Invalid port: ${value}`);
  }
  return port;
}
