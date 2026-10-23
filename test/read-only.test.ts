import { afterAll, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// akapen must never write to the reviewed directory (docs/design/要件.md).
const cli = join(import.meta.dir, "..", "src", "cli.ts");
const base = realpathSync(mkdtempSync(join(tmpdir(), "akapen-readonly-")));
const root = join(base, "project");
const env = { ...process.env, AKAPEN_HOME: join(base, "home") };
afterAll(() => rmSync(base, { recursive: true, force: true }));

mkdirSync(join(root, "src"), { recursive: true });
writeFileSync(join(root, "README.md"), "# Project\n\nSome text.\n");
writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
writeFileSync(join(root, ".gitignore"), "secret.txt\n");
writeFileSync(join(root, "secret.txt"), "x\n");
writeFileSync(join(root, ".env"), "AKAPEN_PORT=1\n");
Bun.spawnSync(["git", "init", "-q"], { cwd: root });
Bun.spawnSync(["git", "add", "README.md", "src", ".gitignore"], { cwd: root });

/** Every file under the root (including .git/) with its content hash and mtime. */
function snapshot(dir = root, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(result, snapshot(path, `${name}/`));
    else {
      const hash = new Bun.CryptoHasher("sha256")
        .update(readFileSync(path))
        .digest("hex");
      result[name] = `${hash} ${statSync(path).mtimeMs}`;
    }
  }
  return result;
}

test("starting, reading, commenting, exporting and ending leave the directory untouched", async () => {
  const before = snapshot();
  await Bun.sleep(20); // so a rewrite would show up as a different mtime

  const server = Bun.spawn([process.execPath, cli, root, "--port", "0"], {
    env,
    stdout: "pipe",
  });
  try {
    let output = "";
    for await (const chunk of server.stdout) {
      output += new TextDecoder().decode(chunk);
      if (output.includes("http://")) break;
    }
    const url = output.match(/http:\/\/\S+/)![0];
    const get = (path: string) =>
      fetch(new URL(path, url)).then((r) => r.json());
    const { token } = (await get("/api/session")) as { token: string };
    const post = (path: string, body: unknown) =>
      fetch(new URL(path, url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Akapen-Token": token,
        },
        body: JSON.stringify(body),
      }).then((r) => r.json());

    expect(await get("/api/tree")).toEqual({
      files: ["src/a.ts", ".env", ".gitignore", "README.md"],
    });
    await get("/api/file?path=README.md");
    await get("/api/file?path=src/a.ts");
    const thread = (await post("/api/threads", {
      path: "src/a.ts",
      startLine: 1,
      endLine: 1,
      originView: "source",
      body: "Rename a",
      author: "Alice",
      clientId: "c",
    })) as { id: string };
    await post("/api/prompt", {
      threadIds: [thread.id],
      resolve: false,
      author: "Alice",
    });

    const exported = Bun.spawnSync([process.execPath, cli, "export", root], {
      env,
    });
    expect(exported.stdout.toString()).toContain("Rename a by Alice");

    await post("/api/session/end", {});
  } finally {
    server.kill();
    await server.exited;
  }

  expect(snapshot()).toEqual(before);
}, 60_000);
