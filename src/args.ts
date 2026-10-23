import { parseArgs } from "node:util";

export const USAGE = `Usage: reviewbuddy [dir] [options]
       reviewbuddy export [dir] [--session <id>] [--status open|resolved|all] [--format prompt|jsonl]
       reviewbuddy session ls [--all] | end [dir|id] | reopen <id> | rm <id...> | prune [--dry-run]
       reviewbuddy config init | path | show

Options:
  -p, --port <number>    Port to listen on (default: 4400, or the next free port)
  -H, --host <address>   Address to bind (default: 127.0.0.1)
      --new              End this directory's active session and start a new one
      --session <id>     Open a session by id (read-only once it has ended)
      --open, --no-open  Open the browser on start (default: config server.open_browser)
      --no-watch         Do not watch files for changes
  -v, --version          Print the version
  -h, --help             Print this help`;

export type ExportStatus = "open" | "resolved" | "all";
export type ExportFormat = "prompt" | "jsonl";
const STATUSES: ExportStatus[] = ["open", "resolved", "all"];
const FORMATS: ExportFormat[] = ["prompt", "jsonl"];
const CONFIG_ACTIONS = ["init", "path", "show"] as const;

export type ServeCommand = {
  kind: "serve";
  dir: string;
  /** Unset unless given; the CLI falls back to the environment, config.toml, then defaults. */
  host?: string;
  port?: number;
  open?: boolean;
  watch: boolean;
  /** --new: end the active session and start a new one. */
  fresh: boolean;
  /** --session: open this session (its root replaces dir). */
  sessionId?: string;
};

export type SessionCommand =
  | { kind: "session"; action: "ls"; all: boolean }
  | { kind: "session"; action: "end"; target: string }
  | { kind: "session"; action: "reopen"; id: string }
  | { kind: "session"; action: "rm"; ids: string[] }
  | { kind: "session"; action: "prune"; dryRun: boolean };

export type Command =
  | ServeCommand
  | {
      kind: "export";
      dir: string;
      sessionId?: string;
      status: ExportStatus;
      format: ExportFormat;
    }
  | SessionCommand
  | { kind: "config"; action: (typeof CONFIG_ACTIONS)[number] }
  | { kind: "version" }
  | { kind: "help" };

export class UsageError extends Error {}

function tryParse<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

function oneOf<T extends string>(
  what: string,
  value: string | undefined,
  allowed: readonly T[],
): T {
  if (!allowed.includes(value as T)) {
    throw new UsageError(
      `Invalid ${what}: ${value ?? "(none)"} (expected ${allowed.join(", ")})`,
    );
  }
  return value as T;
}

function atMostOneDir(positionals: string[]): void {
  if (positionals.length > 1) {
    throw new UsageError(
      `Expected at most one directory, got: ${positionals.join(" ")}`,
    );
  }
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`Invalid port: ${value}`);
  }
  return port;
}

function parseServe(argv: string[]): Command {
  const { values, positionals } = tryParse(() =>
    parseArgs({
      args: argv,
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string", short: "H" },
        new: { type: "boolean" },
        session: { type: "string" },
        open: { type: "boolean" },
        "no-open": { type: "boolean" },
        "no-watch": { type: "boolean" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    }),
  );
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };
  if (values.session !== undefined && positionals.length > 0) {
    throw new UsageError("--session cannot be combined with a directory");
  }
  if (values.session !== undefined && values.new) {
    throw new UsageError("--session cannot be combined with --new");
  }
  if (values.open && values["no-open"]) {
    throw new UsageError("--open cannot be combined with --no-open");
  }
  atMostOneDir(positionals);
  const command: ServeCommand = {
    kind: "serve",
    dir: positionals[0] ?? ".",
    watch: !values["no-watch"],
    fresh: values.new ?? false,
  };
  if (values.host !== undefined) command.host = values.host;
  if (values.port !== undefined) command.port = parsePort(values.port);
  if (values.open) command.open = true;
  if (values["no-open"]) command.open = false;
  if (values.session !== undefined) command.sessionId = values.session;
  return command;
}

function parseExport(argv: string[]): Command {
  const { values, positionals } = tryParse(() =>
    parseArgs({
      args: argv,
      options: {
        session: { type: "string" },
        status: { type: "string" },
        format: { type: "string" },
      },
      allowPositionals: true,
    }),
  );
  if (values.session !== undefined && positionals.length > 0) {
    throw new UsageError("--session cannot be combined with a directory");
  }
  atMostOneDir(positionals);
  return {
    kind: "export",
    dir: positionals[0] ?? ".",
    ...(values.session !== undefined && { sessionId: values.session }),
    status: oneOf("--status", values.status ?? "open", STATUSES),
    format: oneOf("--format", values.format ?? "prompt", FORMATS),
  };
}

function parseSession(argv: string[]): Command {
  const [action, ...rest] = argv;
  const { values, positionals } = tryParse(() =>
    parseArgs({
      args: rest,
      options: { all: { type: "boolean" }, "dry-run": { type: "boolean" } },
      allowPositionals: true,
    }),
  );
  switch (
    oneOf("session command", action, [
      "ls",
      "end",
      "reopen",
      "rm",
      "prune",
    ] as const)
  ) {
    case "ls":
      return { kind: "session", action: "ls", all: values.all ?? false };
    case "end":
      atMostOneDir(positionals);
      return { kind: "session", action: "end", target: positionals[0] ?? "." };
    case "reopen":
      if (positionals.length !== 1)
        throw new UsageError("Expected one session id");
      return { kind: "session", action: "reopen", id: positionals[0]! };
    case "rm":
      if (positionals.length === 0)
        throw new UsageError("Expected at least one session id");
      return { kind: "session", action: "rm", ids: positionals };
    case "prune":
      return {
        kind: "session",
        action: "prune",
        dryRun: values["dry-run"] ?? false,
      };
  }
}

export function parseCliArgs(argv: string[]): Command {
  // A directory with a subcommand's name can still be opened as ./export.
  switch (argv[0]) {
    case "export":
      return parseExport(argv.slice(1));
    case "session":
      return parseSession(argv.slice(1));
    case "config":
      if (argv.length !== 2)
        throw new UsageError("Expected: reviewbuddy config init | path | show");
      return {
        kind: "config",
        action: oneOf("config command", argv[1], CONFIG_ACTIONS),
      };
    default:
      return parseServe(argv);
  }
}
