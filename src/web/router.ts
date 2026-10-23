import { useSyncExternalStore } from "react";

const PREFIX = "#/doc/";

export function docPathFromHash(hash: string): string | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    return (
      hash.slice(PREFIX.length).split("/").map(decodeURIComponent).join("/") ||
      null
    );
  } catch {
    return null; // malformed escape sequence
  }
}

export function hashForDocPath(path: string): string {
  return PREFIX + path.split("/").map(encodeURIComponent).join("/");
}

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
