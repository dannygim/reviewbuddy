import { join } from "node:path";
import { AccessGate, formatPin } from "./auth";
import {
  type Command,
  parseCliArgs,
  type ServeCommand,
  type SessionCommand,
  UsageError,
  USAGE,
} from "./args";
import {
  type Config,
  ConfigError,
  configPath,
  configToToml,
  initConfig,
  loadConfig,
} from "./config/config";
import { FileIndex } from "./files/file-index";
import { exportThreads, findExportSession } from "./prompt/export";
import { openReviewDb } from "./review/db";
import { ReviewStore } from "./review/store";
import { resolveRoot } from "./root";
import { type SessionContext, startServer } from "./server";
import {
  autoPrune,
  endSessionCommand,
  listSessionsText,
  pruneSessions,
  removeSessions,
  reopenSessionCommand,
} from "./session/commands";
import { akapenHome } from "./session/home";
import { findRunningServer, removeLock, writeLock } from "./session/lock";
import {
  localIso,
  openSession,
  readSession,
  SessionError,
  sessionDir,
  touchSession,
  writeSession,
} from "./session/session";
import { VERSION } from "./version";

function settings(home: string) {
  const loaded = loadConfig(home);
  for (const warning of loaded.warnings)
    console.error(`akapen: warning: ${warning}`);
  return loaded;
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    Bun.spawn([command, url], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // No browser launcher; the URL is printed anyway.
  }
}

async function serve(command: ServeCommand, home: string): Promise<void> {
  const { config, portExplicit } = settings(home);
  const pruned = autoPrune(home, config.retention);
  if (pruned) console.log(pruned);

  const { meta, readOnly } = command.sessionId
    ? openSession(home, "", { id: command.sessionId })
    : openSession(home, resolveRoot(command.dir), { fresh: command.fresh });
  const root = resolveRoot(meta.root);
  const dir = sessionDir(home, meta.id);
  const open = command.open ?? config.server.openBrowser;

  const running = await findRunningServer(dir, meta.id);
  if (running) {
    console.log(`akapen is already reviewing ${root}`);
    console.log(`  ${running}`);
    if (open) openBrowser(running);
    return;
  }

  const session: SessionContext = {
    meta,
    readOnly,
    token: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
      "hex",
    ),
    store: new ReviewStore(openReviewDb(join(dir, "review.db"))),
    touch() {
      // Never write back "active" over an end from `akapen session end`.
      if (readSession(home, meta.id)?.status === "ended") return;
      session.meta = touchSession(home, session.meta);
    },
    end() {
      session.meta = {
        ...session.meta,
        status: "ended",
        endedAt: localIso(new Date()),
      };
      writeSession(home, session.meta);
    },
    reload: () => readSession(home, meta.id),
  };
  const access = new AccessGate(undefined, () =>
    console.error(
      "akapen: too many wrong PINs; restart akapen to get a new PIN.",
    ),
  );
  const host = command.host ?? config.server.host;
  const server = startServer({
    root,
    host,
    port: command.port ?? config.server.port,
    // An explicit port must not silently move (e.g. `tailscale serve 4400` proxies to it).
    strictPort: command.port !== undefined || portExplicit,
    index: await FileIndex.create(root, { exclude: config.viewer.exclude }),
    allowedHosts: config.server.allowedHosts,
    maxHighlightBytes: config.viewer.maxHighlightBytes,
    prompt: config.prompt,
    resolveOnCopy: config.prompt.resolveOnCopy,
    session,
    watch: command.watch,
    access,
  });

  writeLock(dir, {
    pid: process.pid,
    host,
    port: server.port!,
    url: server.url.href,
    startedAt: localIso(new Date()),
  });
  process.on("exit", () => removeLock(dir));
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));

  console.log(`akapen ${VERSION} is reviewing ${root}`);
  console.log(`  ${server.url}`);
  console.log(`  PIN: ${formatPin(access.pin)}`);
  if (readOnly)
    console.log(`  Session ${meta.id} has ended; comments are read-only.`);
  if (open) openBrowser(server.url.href);
}

function session(
  command: SessionCommand,
  home: string,
  config: Config,
): string {
  switch (command.action) {
    case "ls":
      return listSessionsText(home, command.all);
    case "end":
      return endSessionCommand(home, command.target);
    case "reopen":
      return reopenSessionCommand(home, command.id);
    case "rm":
      return removeSessions(home, command.ids);
    case "prune":
      return pruneSessions(home, config.retention, command.dryRun);
  }
}

async function run(command: Command): Promise<void> {
  const home = akapenHome();
  switch (command.kind) {
    case "help":
      console.log(USAGE);
      return;
    case "version":
      console.log(VERSION);
      return;
    case "serve":
      return serve(command, home);
    case "export": {
      const { config } = settings(home);
      const meta = findExportSession(
        home,
        command.sessionId
          ? { sessionId: command.sessionId }
          : { root: resolveRoot(command.dir) },
      );
      process.stdout.write(
        exportThreads(home, meta, { ...command, prompt: config.prompt }),
      );
      return;
    }
    case "session":
      console.log(session(command, home, settings(home).config));
      return;
    case "config":
      switch (command.action) {
        case "init":
          console.log(
            initConfig(home)
              ? `Created ${configPath(home)}`
              : `${configPath(home)} already exists; left it unchanged.`,
          );
          return;
        case "path":
          console.log(configPath(home));
          return;
        case "show":
          process.stdout.write(configToToml(settings(home).config));
          return;
      }
  }
}

Promise.resolve()
  .then(() => run(parseCliArgs(Bun.argv.slice(2))))
  .catch((error) => {
    if (error instanceof UsageError) {
      console.error(`akapen: ${error.message}\n\n${USAGE}`);
      process.exitCode = 2;
    } else if (
      error instanceof SessionError ||
      error instanceof ConfigError ||
      (error as { code?: string }).code === "EADDRINUSE"
    ) {
      console.error(`akapen: ${(error as Error).message}`);
      process.exitCode = 1;
    } else {
      console.error(error);
      process.exitCode = 1;
    }
  });
