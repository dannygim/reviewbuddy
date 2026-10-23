import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { UsageError } from "./args";

export function resolveRoot(dir: string, cwd: string = process.cwd()): string {
  const path = resolve(cwd, dir);
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) throw new UsageError(`Directory not found: ${dir}`);
  if (!stat.isDirectory()) throw new UsageError(`Not a directory: ${dir}`);
  return realpathSync(path);
}

/** The root for display, with the home directory shown as ~. */
export function displayRoot(root: string, home: string = homedir()): string {
  if (root === home) return "~";
  return root.startsWith(`${home}/`) ? `~${root.slice(home.length)}` : root;
}
