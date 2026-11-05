import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type FileIndex, isInsideGitWorkTree } from "../files/file-index";
import { splitLines } from "../render/highlight";
import type { ChangedFile, ChangesResponse } from "../shared/api";
import { compareTreePaths } from "../shared/tree";
import { gitText, isBinary, splitNul } from "./git";

/** A change before its lines are counted (undefined) and its version is known. */
type Entry = Omit<ChangedFile, "version" | "additions" | "deletions"> & {
  additions: number | null | undefined;
  deletions: number | null | undefined;
};

/**
 * The files whose content differs between HEAD and the work tree, limited to
 * what the file tree shows (docs/design/差分表示.md).
 */
export async function listChanges(
  root: string,
  index: FileIndex,
): Promise<ChangesResponse> {
  if (!(await isInsideGitWorkTree(root))) return { git: false, files: [] };
  const head = await gitText(root, ["rev-parse", "--verify", "-q", "HEAD"]);
  const entries: Entry[] =
    head === null
      ? index.paths().map(added)
      : (await Promise.all([tracked(root), untracked(root)])).flat();
  const files = entries
    .filter((e) =>
      e.status === "deleted" ? !index.excludes(e.path) : index.has(e.path),
    )
    .map((e) => withVersion(root, e))
    .filter((file) => file !== null);
  return {
    git: true,
    files: files.sort((a, b) => compareTreePaths(a.path, b.path)),
  };
}

const added = (path: string): Entry => ({
  path,
  oldPath: null,
  status: "added",
  additions: undefined,
  deletions: undefined,
});

async function tracked(root: string): Promise<Entry[]> {
  const diff = (format: string) =>
    gitText(root, ["diff-index", "HEAD", "-M", "--relative", format, "-z"]);
  // --numstat compares contents, so files that were only touched are left
  // out; --name-status (stat only) adds the status letters.
  const [numstat, nameStatus] = await Promise.all([
    diff("--numstat"),
    diff("--name-status"),
  ]);
  const letters = new Map<string, string>();
  const names = splitNul(nameStatus ?? "");
  for (let i = 0; i < names.length;) {
    const letter = names[i++]![0]!;
    if (letter === "R" || letter === "C") i++; // the old path
    letters.set(names[i++]!, letter);
  }
  const entries: Entry[] = [];
  const records = splitNul(numstat ?? "");
  for (let i = 0; i < records.length;) {
    // "<added>\t<deleted>\t<path>", or "<added>\t<deleted>\t" then both paths.
    const record = records[i++]!;
    const first = record.indexOf("\t");
    const second = record.indexOf("\t", first + 1);
    const add = record.slice(0, first);
    const del = record.slice(first + 1, second);
    const single = record.slice(second + 1);
    const oldPath = single === "" ? records[i++]! : null;
    const path = single === "" ? records[i++]! : single;
    const letter = letters.get(path);
    entries.push({
      path,
      oldPath,
      status:
        letter === "A"
          ? "added"
          : letter === "D"
            ? "deleted"
            : oldPath
              ? "renamed"
              : "modified",
      additions: add === "-" ? null : Number(add),
      deletions: del === "-" ? null : Number(del),
    });
  }
  return entries;
}

async function untracked(root: string): Promise<Entry[]> {
  const out = await gitText(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  return splitNul(out ?? "").map(added);
}

/** Counts the lines of new files and adds the version; null if the file is gone. */
function withVersion(root: string, entry: Entry): ChangedFile | null {
  if (entry.status === "deleted") {
    return {
      ...entry,
      additions: entry.additions ?? null,
      deletions: entry.deletions ?? null,
      version: `deleted:${entry.deletions}`,
    };
  }
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(join(root, entry.path));
  } catch {
    return null; // deleted since git listed it
  }
  let { additions, deletions } = entry;
  if (additions === undefined) {
    const text = isBinary(bytes) ? null : new TextDecoder().decode(bytes);
    additions =
      text === null ? null : text === "" ? 0 : splitLines(text).length;
    deletions = text === null ? null : 0;
  }
  return {
    ...entry,
    additions,
    deletions: deletions ?? null,
    version: [
      entry.status,
      entry.oldPath,
      additions,
      deletions,
      Bun.hash(bytes),
    ].join(":"),
  };
}
