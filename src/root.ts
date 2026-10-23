import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { UsageError } from "./args";

export function resolveRoot(dir: string, cwd: string = process.cwd()): string {
  const path = resolve(cwd, dir);
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) throw new UsageError(`Directory not found: ${dir}`);
  if (!stat.isDirectory()) throw new UsageError(`Not a directory: ${dir}`);
  return realpathSync(path);
}
