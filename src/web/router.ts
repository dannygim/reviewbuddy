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

export function openDoc(path: string): void {
  window.location.hash = hashForDocPath(path);
}

/** Like openDoc, but replaces the current history entry instead of adding one. */
export function replaceDoc(path: string): void {
  window.location.replace(hashForDocPath(path));
}
