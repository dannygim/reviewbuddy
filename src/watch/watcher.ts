import { watch } from "node:fs";
import { sep } from "node:path";

export type Change = {
  /** Listed files that changed (or were deleted). */
  files: string[];
  /** Something unlisted changed (a new file, .git/, ...): re-list the files. */
  tree: boolean;
};

/**
 * Watches the root recursively and reports changes in batches, `debounceMs`
 * after the first event. Returns a function that stops watching.
 */
export function watchRoot(
  root: string,
  isListed: (path: string) => boolean,
  onChange: (change: Change) => void,
  debounceMs = 200,
): () => void {
  const files = new Set<string>();
  let tree = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    const change = { files: [...files], tree };
    files.clear();
    tree = false;
    onChange(change);
  };

  const watcher = watch(root, { recursive: true }, (_event, name) => {
    const path = name ? String(name).split(sep).join("/") : null;
    if (path && isListed(path)) files.add(path);
    else tree = true;
    timer ??= setTimeout(flush, debounceMs);
  });
  // Never keep the process alive just for watching.
  watcher.unref();

  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
