import { useSyncExternalStore } from "react";

// Bumped on each file.changed event, so viewers know to fetch again.
let versions = new Map<string, number>();
const listeners = new Set<() => void>();

export function bumpFileVersion(path: string): void {
  versions = new Map(versions).set(path, (versions.get(path) ?? 0) + 1);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFileVersion(path: string): number {
  return useSyncExternalStore(subscribe, () => versions.get(path) ?? 0);
}
