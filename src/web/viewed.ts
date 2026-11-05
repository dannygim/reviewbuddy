import { useMemo, useState } from "react";
import type { ChangedFile } from "../shared/api";
import { read, write } from "./identity";

/** The version of each file's change when it was marked Viewed. */
export type ViewedMarks = Record<string, string>;

export function parseViewed(value: string | null): ViewedMarks {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? "");
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(([, v]) => typeof v === "string"),
  ) as ViewedMarks;
}

/** Files marked Viewed whose change has not changed since. */
export function viewedPaths(
  marks: ViewedMarks,
  files: ChangedFile[],
): Set<string> {
  return new Set(
    files.filter((f) => marks[f.path] === f.version).map((f) => f.path),
  );
}

/** Marks or unmarks a file, keeping only the files that are still changed. */
export function markViewed(
  marks: ViewedMarks,
  files: ChangedFile[],
  path: string,
  viewed: boolean,
): ViewedMarks {
  const next: ViewedMarks = {};
  for (const f of files) {
    const version =
      f.path === path ? (viewed ? f.version : undefined) : marks[f.path];
    if (version !== undefined) next[f.path] = version;
  }
  return next;
}

/**
 * Viewed marks for this browser, per session (docs/design/差分表示.md): kept
 * in localStorage only, never sent to the server.
 */
export function useViewed(
  sessionId: string,
  files: ChangedFile[],
): [Set<string>, (path: string, viewed: boolean) => void] {
  const key = `reviewbuddy.viewed.${sessionId}`;
  // The session is known only once loaded, so the key can change.
  const stored = useMemo(() => parseViewed(read(key)), [key]);
  const [saved, setSaved] = useState<{ key: string; marks: ViewedMarks }>();
  const marks = saved?.key === key ? saved.marks : stored;
  const set = (path: string, viewed: boolean) => {
    const next = markViewed(marks, files, path, viewed);
    write(key, JSON.stringify(next));
    setSaved({ key, marks: next });
  };
  return [viewedPaths(marks, files), set];
}
