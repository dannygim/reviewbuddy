import { useSyncExternalStore } from "react";
import type { Thread } from "../shared/api";

// All threads of the session, kept in sync by API responses (and, from M4, by
// WebSocket events).
let threads = new Map<string, Thread>();
let snapshot: Thread[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = [...threads.values()];
  for (const listener of listeners) listener();
}

export const threadStore = {
  replaceAll(list: Thread[]): void {
    threads = new Map(list.map((thread) => [thread.id, thread]));
    emit();
  },
  upsert(thread: Thread): void {
    threads.set(thread.id, thread);
    emit();
  },
  remove(id: string): void {
    threads.delete(id);
    emit();
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThreads(): Thread[] {
  return useSyncExternalStore(subscribe, () => snapshot);
}
