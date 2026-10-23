import { afterAll, afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Change, watchRoot } from "./watcher";

const base = realpathSync(mkdtempSync(join(tmpdir(), "reviewbuddy-watch-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));

let stop: (() => void) | undefined;
afterEach(() => stop?.());

let n = 0;
async function setup(listed: string[]) {
  const root = join(base, `r${n++}`);
  mkdirSync(join(root, "doc"), { recursive: true });
  for (const path of listed) writeFileSync(join(root, path), "1");
  const changes: Change[] = [];
  let wake: (() => void) | undefined;
  stop = watchRoot(
    root,
    (path) => listed.includes(path),
    (change) => {
      changes.push(change);
      wake?.();
    },
    50,
  );
  // FSEvents can replay events from just before the watch began.
  await Bun.sleep(300);
  changes.length = 0;
  const next = async (): Promise<Change> => {
    while (changes.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 2000);
      });
    }
    return changes.shift()!;
  };
  return { root, next };
}

test("reports changes to listed files, batched", async () => {
  const { root, next } = await setup(["a.md", "doc/b.md"]);
  writeFileSync(join(root, "a.md"), "2");
  writeFileSync(join(root, "doc/b.md"), "2");
  const change = await next();
  expect(change.files.sort()).toEqual(["a.md", "doc/b.md"]);
});

test("asks for a tree refresh for paths it does not list", async () => {
  const { root, next } = await setup(["a.md"]);
  mkdirSync(join(root, "new/deep"), { recursive: true });
  writeFileSync(join(root, "new/deep/c.md"), "c");
  const change = await next();
  expect(change.tree).toBe(true);
  expect(change.files).toEqual([]);
});

test("reports a deleted listed file", async () => {
  const { root, next } = await setup(["a.md"]);
  rmSync(join(root, "a.md"));
  expect((await next()).files).toEqual(["a.md"]);
});
