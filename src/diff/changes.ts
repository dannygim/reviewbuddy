import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { type FileIndex, isInsideGitWorkTree } from "../files/file-index";
import { resolveFile } from "../files/resolve";
import { splitLines } from "../render/highlight";
import type { ChangedFile, ChangesResponse } from "../shared/api";
import { compareTreePaths } from "../shared/tree";
import { BaseError, type Branch, baseCommit } from "./branches";
import { lineChanges } from "./file-diff";
import { gitOutput, gitText, isBinary, splitNul } from "./git";

/** A change before its lines are counted (undefined) and its version is known. */
type Entry = Omit<ChangedFile, "version" | "additions" | "deletions"> & {
  additions: number | null | undefined;
  deletions: number | null | undefined;
  /** The file's blob in the base commit, or null when it does not have it. */
  base: string | null;
};

/**
 * The files whose content differs between HEAD (or where HEAD left `base`)
 * and the work tree, limited to what the file tree shows
 * (docs/design/差分表示.md).
 */
export async function listChanges(
  root: string,
  index: FileIndex,
  base: Branch | null = null,
): Promise<ChangesResponse> {
  if (!(await isInsideGitWorkTree(root))) return { git: false, files: [] };
  const commit = await baseCommit(root, base?.ref ?? null);
  if (base && commit === null) throw new BaseError(base.name);
  const entries: Entry[] =
    commit === null
      ? index.paths().map(added)
      : withRemovedFromIndex(
          ...(await Promise.all([tracked(root, commit), untracked(root)])),
        );
  const files = (
    await Promise.all(
      entries
        .filter((e) =>
          e.status === "deleted" ? !index.excludes(e.path) : index.has(e.path),
        )
        .map((e) => withVersion(root, index, e)),
    )
  ).filter((file) => file !== null);
  return {
    git: true,
    files: files.sort((a, b) => compareTreePaths(a.path, b.path)),
  };
}

/**
 * The work-tree side of a change as Git compares it: a symlink's target path,
 * never the file it points to. Null when the file is gone or not listed.
 */
export function readWorkTree(
  root: string,
  index: FileIndex,
  path: string,
): Uint8Array | null {
  const abs = join(root, path);
  try {
    if (lstatSync(abs).isSymbolicLink()) {
      return index.has(path) ? readlinkSync(abs, { encoding: "buffer" }) : null;
    }
    const real = resolveFile(root, index, path);
    return real ? readFileSync(real) : null;
  } catch {
    return null; // deleted since git listed it
  }
}

const added = (path: string): Entry => ({
  path,
  oldPath: null,
  status: "added",
  additions: undefined,
  deletions: undefined,
  base: null,
});

async function tracked(root: string, commit: string): Promise<Entry[]> {
  const diff = (format: string) =>
    gitText(root, ["diff-index", commit, "-M", "--relative", format, "-z"]);
  // --numstat compares contents, so files that were only touched are left
  // out; --raw (stat only) adds the status letters and the blobs in the commit.
  const [numstat, raw] = await Promise.all([diff("--numstat"), diff("--raw")]);
  const heads = new Map<string, { letter: string; base: string | null }>();
  const fields = splitNul(raw ?? "");
  for (let i = 0; i < fields.length;) {
    // ":<old mode> <new mode> <old blob> <new blob> <status>", then the path,
    // or both paths for a rename or copy.
    const [, , base, , status] = fields[i++]!.split(" ");
    const letter = status![0]!;
    if (letter === "R" || letter === "C") i++; // the old path
    heads.set(fields[i++]!, {
      letter,
      base: letter === "A" ? null : base!,
    });
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
    const { letter, base } = heads.get(path) ?? { letter: "M", base: null };
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
      base,
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

/**
 * A file removed from the index (`git rm --cached`) but kept on disk is both a
 * deletion for Git and untracked. Only HEAD and the work tree count, so it is
 * one modified file, its lines counted against HEAD (and left out if equal).
 */
function withRemovedFromIndex(changed: Entry[], others: Entry[]): Entry[] {
  const onDisk = new Set(others.map((e) => e.path));
  const kept = new Set<string>();
  const entries = changed.map((e): Entry => {
    if (e.status !== "deleted" || !onDisk.has(e.path)) return e;
    kept.add(e.path);
    return {
      ...e,
      status: "modified",
      additions: undefined,
      deletions: undefined,
    };
  });
  return [...entries, ...others.filter((e) => !kept.has(e.path))];
}

/**
 * Counts the lines where Git did not and adds the version; null if the file is
 * gone or equal to HEAD.
 */
async function withVersion(
  root: string,
  index: FileIndex,
  entry: Entry,
): Promise<ChangedFile | null> {
  const { base, ...file } = entry;
  if (entry.status === "deleted") {
    return {
      ...file,
      additions: entry.additions ?? null,
      deletions: entry.deletions ?? null,
      version: `deleted:${base}`,
    };
  }
  const bytes = readWorkTree(root, index, entry.path);
  if (!bytes) return null;
  let { additions, deletions } = entry;
  if (additions === undefined) {
    const old = base
      ? ((await gitOutput(root, ["cat-file", "blob", base])) ??
        new Uint8Array())
      : new Uint8Array();
    if (base && Buffer.from(old).equals(bytes)) return null;
    [additions, deletions] = countLines(old, bytes);
  }
  return {
    ...file,
    additions,
    deletions: deletions ?? null,
    version: [
      entry.status,
      entry.oldPath,
      base,
      additions,
      deletions,
      Bun.hash(bytes),
    ].join(":"),
  };
}

/** Added and deleted lines, or nulls for a binary file. */
function countLines(
  old: Uint8Array,
  bytes: Uint8Array,
): [number | null, number | null] {
  if (isBinary(old) || isBinary(bytes)) return [null, null];
  const lines = (b: Uint8Array) => {
    const text = new TextDecoder().decode(b);
    return text === "" ? [] : splitLines(text);
  };
  const changes = lineChanges(lines(old), lines(bytes));
  return [
    changes.reduce((sum, c) => sum + c.newCount, 0),
    changes.reduce((sum, c) => sum + c.oldCount, 0),
  ];
}
