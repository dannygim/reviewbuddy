import { useSyncExternalStore } from "react";
import { docPathFromHash, hashForDocPath } from "../shared/doc-link";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** The file path in the URL hash (`#/doc/<path>`), or null. */
export function useDocPath(): string | null {
  return useSyncExternalStore(subscribe, () =>
    docPathFromHash(window.location.hash),
  );
}

const CHANGES_HASH = "#/changes";

/** Whether the URL hash shows the Changes view (`#/changes`). */
export function useChangesOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.location.hash === CHANGES_HASH,
  );
}

export function openChanges(): void {
  window.location.hash = CHANGES_HASH;
}

/** Leaves the Changes view for a file, or for no file (the root README.md). */
export function openFiles(path: string | null): void {
  window.location.hash = path ? hashForDocPath(path) : "";
}

export function openDoc(path: string): void {
  window.location.hash = hashForDocPath(path);
}

/** Like openDoc, but replaces the current history entry instead of adding one. */
export function replaceDoc(path: string): void {
  window.location.replace(hashForDocPath(path));
}
