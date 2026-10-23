import { join } from "node:path";
import { parseCliArgs, UsageError, USAGE } from "./args";
import { FileIndex } from "./files/file-index";
import { DEFAULT_MAX_HIGHLIGHT_BYTES } from "./render/file-view";
import { openReviewDb } from "./review/db";
import { ReviewStore } from "./review/store";
import { resolveRoot } from "./root";
import { type SessionContext, startServer } from "./server";
import { akapenHome } from "./session/home";
import { findRunningServer, removeLock, writeLock } from "./session/lock";
import {
  localIso,
  openSession,
  SessionError,
  sessionDir,
  touchSession,
} from "./session/session";
import { VERSION } from "./version";

type ServeCommand = Extract<ReturnType<typeof parseCliArgs>, { kind: "serve" }>;

async function serve(command: ServeCommand): Promise<void> {
  const home = akapenHome();
  const { meta, readOnly } = command.sessionId
    ? openSession(home, "", { id: command.sessionId })
    : openSession(home, resolveRoot(command.dir), { fresh: command.fresh });
  const root = resolveRoot(meta.root);
  const dir = sessionDir(home, meta.id);

  const running = await findRunningServer(dir, meta.id);
  if (running) {
    console.log(`akapen is already reviewing ${root}`);
    console.log(`  ${running}`);
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
      session.meta = touchSession(home, session.meta);
    },
  };
  const server = startServer({
    ...command,
    root,
    index: await FileIndex.create(root),
    allowedHosts: [],
    maxHighlightBytes: DEFAULT_MAX_HIGHLIGHT_BYTES,
    session,
  });

  writeLock(dir, {
    pid: process.pid,
    host: command.host,
    port: server.port!,
    url: server.url.href,
    startedAt: localIso(new Date()),
  });
  process.on("exit", () => removeLock(dir));
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));

  console.log(`akapen ${VERSION} is reviewing ${root}`);
  console.log(`  ${server.url}`);
  if (readOnly)
    console.log(`  Session ${meta.id} has ended; comments are read-only.`);
}

async function run(argv: string[]): Promise<void> {
  const command = parseCliArgs(argv);
  switch (command.kind) {
    case "help":
      console.log(USAGE);
      return;
    case "version":
      console.log(VERSION);
      return;
    case "serve":
      return serve(command);
  }
}

run(Bun.argv.slice(2)).catch((error) => {
  if (error instanceof UsageError) {
    console.error(`akapen: ${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else if (
    error instanceof SessionError ||
    (error as { code?: string }).code === "EADDRINUSE"
  ) {
    console.error(`akapen: ${(error as Error).message}`);
    process.exitCode = 1;
  } else {
    console.error(error);
    process.exitCode = 1;
  }
});
