import { sep } from "node:path";

/**
 * Runs a read-only git command in `root` and returns its output, or null when
 * it fails. Only plumbing commands are used: porcelain ones such as `git diff`
 * rewrite .git/index even with --no-optional-locks
 * (docs/research/git_差分_調査.md).
 */
export async function gitOutput(
  root: string,
  args: string[],
): Promise<Uint8Array | null> {
  try {
    const proc = Bun.spawn(
      ["git", "--no-optional-locks", "-C", root, ...args],
      { stdout: "pipe", stderr: "ignore" },
    );
    const out = await new Response(proc.stdout).bytes();
    return (await proc.exited) === 0 ? out : null;
  } catch {
    return null; // `git` is not installed
  }
}

export async function gitText(
  root: string,
  args: string[],
): Promise<string | null> {
  const out = await gitOutput(root, args);
  return out && new TextDecoder().decode(out);
}

/** Splits NUL-separated output (-z), dropping the empty field after the last NUL. */
export function splitNul(text: string): string[] {
  const fields = text.split("\0");
  if (fields.at(-1) === "") fields.pop();
  return fields;
}

/** Binary like Git and the file viewer: a NUL byte in the first 8 KB. */
export function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8192).includes(0);
}

/**
 * Git's own directories (the git directory with HEAD and the index, and the
 * common one with the refs) that are outside the root: in a linked worktree or
 * when the root is inside a repository. A commit there changes nothing in the
 * root. Empty without Git or before Git 2.31 (--path-format).
 */
export async function gitDirsOutside(root: string): Promise<string[]> {
  const out = await gitText(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
    "--git-common-dir",
  ]);
  const dirs = new Set((out ?? "").split("\n").filter(Boolean));
  return [...dirs].filter((dir) => dir !== root && !dir.startsWith(root + sep));
}
