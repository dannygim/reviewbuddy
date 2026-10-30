import { useSyncExternalStore } from "react";
import { read, write } from "./identity";

export type Pane = "fileTree" | "commentPane";

const KEYS: Record<Pane, string> = {
  fileTree: "reviewbuddy.fileTree",
  commentPane: "reviewbuddy.commentPane",
};

/** A stored value; only "closed" closes the pane. */
export function parsePaneOpen(value: string | null): boolean {
  return value !== "closed";
}

// Read lazily: unit tests run without a DOM, so nothing here may touch
// localStorage at module load.
const open = new Map<Pane, boolean>();
const listeners = new Set<() => void>();

function isOpen(pane: Pane): boolean {
  let value = open.get(pane);
  if (value === undefined) {
    value = parsePaneOpen(read(KEYS[pane]));
    open.set(pane, value);
  }
  return value;
}

function setOpen(pane: Pane, next: boolean): void {
  open.set(pane, next);
  write(KEYS[pane], next ? "open" : "closed");
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePaneOpen(pane: Pane): [boolean, (open: boolean) => void] {
  return [
    useSyncExternalStore(subscribe, () => isOpen(pane)),
    (next) => setOpen(pane, next),
  ];
}
