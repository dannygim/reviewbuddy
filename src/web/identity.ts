import { useState } from "react";

const NICKNAME_KEY = "akapen.nickname";
const CLIENT_ID_KEY = "akapen.clientId";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: keep it for this page only
  }
}

/**
 * A random per-browser ID. crypto.getRandomValues works over plain http://
 * (unlike crypto.randomUUID), which matters for direct tailnet access.
 */
function loadClientId(): string {
  const saved = read(CLIENT_ID_KEY);
  if (saved) return saved;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  write(CLIENT_ID_KEY, id);
  return id;
}

export const clientId = loadClientId();

export function useNickname(): [string | null, (name: string) => void] {
  const [nickname, setNickname] = useState(() => read(NICKNAME_KEY));
  const save = (name: string) => {
    write(NICKNAME_KEY, name);
    setNickname(name);
  };
  return [nickname, save];
}
