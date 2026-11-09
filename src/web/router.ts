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

/**
 * The branch a Changes view hash compares with (`#/changes?base=<branch>`):
 * null for HEAD (`#/changes`), undefined for a hash of another view.
 */
export function changesBase(hash: string): string | null | undefined {
  if (hash === CHANGES_HASH) return null;
  if (!hash.startsWith(`${CHANGES_HASH}?`)) return undefined;
  const params = new URLSearchParams(hash.slice(CHANGES_HASH.length + 1));
  return params.get("base") || null;
}

export function changesHash(base: string | null): string {
  return base
    ? `${CHANGES_HASH}?${new URLSearchParams({ base })}`
    : CHANGES_HASH;
}

/** Whether the URL hash shows the Changes view. */
export function useChangesOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => changesBase(window.location.hash) !== undefined,
  );
}

/** The branch the Changes view compares with, or null for HEAD. */
export function useChangesBase(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => changesBase(window.location.hash) ?? null,
  );
}

export function openChanges(base: string | null): void {
  window.location.hash = changesHash(base);
}

/** Compares with another branch, replacing the current history entry. */
export function replaceChangesBase(base: string | null): void {
  window.location.replace(changesHash(base));
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
