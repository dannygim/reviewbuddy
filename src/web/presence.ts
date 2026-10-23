import { useSyncExternalStore } from "react";
import type { Participant } from "../shared/events";

let participants: Participant[] = [];
const listeners = new Set<() => void>();

export const presenceStore = {
  replaceAll(next: Participant[]): void {
    participants = next;
    for (const listener of listeners) listener();
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePresence(): Participant[] {
  return useSyncExternalStore(subscribe, () => participants);
}

/** One entry per person (a person may have several tabs open). */
export function uniquePeople(list: Participant[]): Participant[] {
  const seen = new Map<string, Participant>();
  for (const p of list) if (!seen.has(p.clientId)) seen.set(p.clientId, p);
  return [...seen.values()];
}

export function initials(nickname: string): string {
  return [...nickname.trim()][0]?.toUpperCase() ?? "?";
}
