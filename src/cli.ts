import { parseCliArgs, UsageError, USAGE } from "./args";
import { FileIndex } from "./files/file-index";
import { DEFAULT_MAX_HIGHLIGHT_BYTES } from "./render/file-view";
import { resolveRoot } from "./root";
import { startServer } from "./server";
import { VERSION } from "./version";

async function run(argv: string[]): Promise<void> {
  const command = parseCliArgs(argv);
  switch (command.kind) {
    case "help":
      console.log(USAGE);
      return;
    case "version":
      console.log(VERSION);
      return;
    case "serve": {
      const root = resolveRoot(command.dir);
      const index = await FileIndex.create(root);
      const server = startServer({
        ...command,
        root,
        index,
        allowedHosts: [],
        maxHighlightBytes: DEFAULT_MAX_HIGHLIGHT_BYTES,
      });
      console.log(`akapen ${VERSION} is reviewing ${root}`);
      console.log(`  ${server.url}`);
      return;
    }
  }
}

run(Bun.argv.slice(2)).catch((error) => {
  if (error instanceof UsageError) {
    console.error(`akapen: ${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else if ((error as { code?: string }).code === "EADDRINUSE") {
    console.error(`akapen: ${(error as Error).message}`);
    process.exitCode = 1;
  } else {
    console.error(error);
    process.exitCode = 1;
  }
});
