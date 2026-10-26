import { useSyncExternalStore } from "react";
import { read, write } from "./identity";

export type DisplayMode = "light" | "dark" | "system";
export type ColorScheme = "light" | "dark";

const KEY = "reviewbuddy.displayMode";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** A stored value; anything else (or nothing) is "system". */
export function parseDisplayMode(value: string | null): DisplayMode {
  return value === "light" || value === "dark" ? value : "system";
}

// Read lazily: unit tests run without a DOM, so nothing here may touch
// window/document/localStorage at module load.
let mode: DisplayMode | null = null;
const listeners = new Set<() => void>();

function currentMode(): DisplayMode {
  mode ??= parseDisplayMode(read(KEY));
  return mode;
}

function apply(next: DisplayMode): void {
  const root = document.documentElement;
  if (next === "system") root.removeAttribute("data-display-mode");
  else root.setAttribute("data-display-mode", next);
}

/** Applies the stored mode to <html>; call before the first render. */
export function initDisplayMode(): void {
  apply(currentMode());
}

function setMode(next: DisplayMode): void {
  mode = next;
  write(KEY, next);
  apply(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDisplayMode(): [DisplayMode, (mode: DisplayMode) => void] {
  return [useSyncExternalStore(subscribe, currentMode), setMode];
}

function subscribeScheme(listener: () => void): () => void {
  const query = matchMedia(DARK_QUERY);
  query.addEventListener("change", listener);
  const unsubscribe = subscribe(listener);
  return () => {
    query.removeEventListener("change", listener);
    unsubscribe();
  };
}

function currentScheme(): ColorScheme {
  const m = currentMode();
  if (m !== "system") return m;
  return matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** The scheme in effect: the mode, or the OS setting under System. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribeScheme, currentScheme);
}
