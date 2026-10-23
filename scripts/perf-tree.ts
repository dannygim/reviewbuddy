// Measures FileIndex creation and GET /api/tree on a generated repository.
// Usage: bun scripts/perf-tree.ts [fileCount]
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileIndex } from "../src/files/file-index";
import { startServer } from "../src/server";

const count = Number(Bun.argv[2] ?? 20_000);
const root = realpathSync(mkdtempSync(join(tmpdir(), "akapen-perf-")));
try {
  for (let i = 0; i < count; i++) {
    const dir = join(root, `d${i % 20}`, `e${i % 25}`, `f${i % 8}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `file${i}.ts`), "");
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  Bun.spawnSync(["git", "add", "."], { cwd: root });

  let start = performance.now();
  const index = await FileIndex.create(root);
  const indexMs = performance.now() - start;

  const server = startServer({
    root,
    host: "127.0.0.1",
    port: 0,
    strictPort: true,
    index,
    allowedHosts: [],
    maxHighlightBytes: 2_000_000,
  });
  start = performance.now();
  const body = await (await fetch(new URL("/api/tree", server.url))).text();
  const treeMs = performance.now() - start;

  // Page load until the tree is rendered (the SPA fetches /api/tree itself).
  await using view = new Bun.WebView({ width: 1200, height: 800 });
  start = performance.now();
  await view.navigate(server.url.href);
  while (
    !(await view.evaluate(
      `document.querySelectorAll(".tree button").length > 0`,
    ))
  )
    await Bun.sleep(10);
  const renderMs = performance.now() - start;
  await server.stop(true);

  console.log(`files: ${index.paths().length}`);
  console.log(`FileIndex.create: ${indexMs.toFixed(0)} ms`);
  console.log(
    `GET /api/tree: ${treeMs.toFixed(0)} ms (${(body.length / 1024).toFixed(0)} KB)`,
  );
  console.log(`page load to rendered tree: ${renderMs.toFixed(0)} ms`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
