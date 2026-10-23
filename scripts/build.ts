// Builds the single-binary executable. `bun run build` runs this; the release
// workflow adds --target to cross-compile (docs/design/配布.md).
// Usage: bun scripts/build.ts [--target bun-linux-x64] [--outfile dist/reviewbuddy]
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { target: { type: "string" }, outfile: { type: "string" } },
});

const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  compile: {
    outfile: values.outfile ?? "dist/reviewbuddy",
    ...(values.target && { target: values.target as Bun.Build.CompileTarget }),
    // The binary runs inside the reviewed project: never load its .env or bunfig.toml.
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
  // Mermaid is loaded on demand only when the frontend is split into chunks.
  splitting: true,
  minify: true,
  sourcemap: "linked",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
