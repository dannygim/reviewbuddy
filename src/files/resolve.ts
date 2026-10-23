import { realpathSync } from "node:fs";
import { join, sep } from "node:path";
import type { FileIndex } from "./file-index";

/**
 * Returns the real absolute path of a listed file, or null when the path is
 * not listed or resolves (e.g. through a symlink) outside the root.
 * `root` must itself be a real path.
 */
export function resolveFile(
  root: string,
  index: FileIndex,
  path: string,
): string | null {
  if (!index.has(path)) return null;
  let real: string;
  try {
    real = realpathSync(join(root, path));
  } catch {
    return null;
  }
  return real.startsWith(root + sep) ? real : null;
}
