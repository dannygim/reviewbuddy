import { parseCliArgs, UsageError, USAGE } from "./args";
import { resolveRoot } from "./root";
import { startServer } from "./server";
import { VERSION } from "./version";

function run(argv: string[]): void {
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
      const server = startServer({ ...command, root });
      console.log(`akapen ${VERSION} is reviewing ${root}`);
      console.log(`  ${server.url}`);
      return;
    }
  }
}

try {
  run(Bun.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`akapen: ${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else if ((error as { code?: string }).code === "EADDRINUSE") {
    console.error(`akapen: ${(error as Error).message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
