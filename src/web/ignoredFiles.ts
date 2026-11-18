import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { fetchIgnored } from "./api";
import { read, write } from "./identity";

const KEY = "reviewbuddy.ignoredFiles";

/** A stored value; only "shown" shows ignored files. */
export function parseIgnoredFiles(value: string | null): boolean {
  return value === "shown";
}

// Read lazily: unit tests run without a DOM, so nothing here may touch
// localStorage at module load.
let shown: boolean | null = null;
const listeners = new Set<() => void>();

function isShown(): boolean {
  shown ??= parseIgnoredFiles(read(KEY));
  return shown;
}

function setShown(next: boolean): void {
  shown = next;
  write(KEY, next ? "shown" : "hidden");
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether this browser shows ignored files in the File Tree (owner only). */
export function useIgnoredFilesShown(): [boolean, (shown: boolean) => void] {
  return [useSyncExternalStore(subscribe, isShown), setShown];
}

export type IgnoredEntries = {
  /** Ignored files and folded directories ("dist/") known so far. */
  paths: string[];
  /** Whether a folded directory's entries ("dist/") have arrived. */
  isLoaded(dir: string): boolean;
  /** Loads a folded directory's entries ("dist/"), once until listed again. */
  open(dir: string): void;
};

/**
 * The ignored entries for the File Tree: the root listing, then each folded
 * directory as it is opened. Nothing while hidden. Listed again when shown
 * again or when `version` changes (tree.changed), keeping the old root
 * listing until the new one arrives.
 */
export function useIgnoredEntries(
  shown: boolean,
  version: number,
): IgnoredEntries {
  const [root, setRoot] = useState<string[]>([]);
  const [inside, setInside] = useState<ReadonlyMap<string, string[]>>(
    () => new Map(),
  );
  // Requests from an older listing must not land in a newer one.
  const generation = useRef(0);
  const asked = useRef(new Set<string>());

  useEffect(() => {
    const current = ++generation.current;
    asked.current = new Set();
    setInside(new Map());
    if (!shown) {
      setRoot([]);
      return;
    }
    fetchIgnored(null).then(
      (res) => current === generation.current && setRoot(res.paths),
      () => {}, // the next tree.changed or reconnect lists again
    );
  }, [shown, version]);

  const open = useCallback((dir: string) => {
    if (asked.current.has(dir)) return;
    asked.current.add(dir);
    const current = generation.current;
    const done = (paths: string[]) =>
      current === generation.current &&
      setInside((prev) => new Map(prev).set(dir, paths));
    // A directory gone meanwhile shows as empty.
    fetchIgnored(dir).then(
      (res) => done(res.paths),
      () => done([]),
    );
  }, []);

  return useMemo(
    () => ({
      paths: [...root, ...[...inside.values()].flat()],
      isLoaded: (dir) => inside.has(dir),
      open,
    }),
    [root, inside, open],
  );
}
