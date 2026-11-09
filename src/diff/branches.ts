import { gitText } from "./git";

/** A branch the Changes view can compare with (docs/design/差分表示.md#比較の基準). */
export type Branch = {
  /** The short name shown and sent by the browser (`main`, `origin/main`). */
  name: string;
  /** The full refname, the only form passed to git. */
  ref: string;
  remote: boolean;
};

/** The branch has no common ancestor with HEAD (or there is no HEAD). */
export class BaseError extends Error {
  constructor(name: string) {
    super(`No common ancestor with ${name}.`);
  }
}

/**
 * Local and remote-tracking branches, without the current one (where HEAD
 * left it is HEAD itself) and symrefs such as `origin/HEAD`. Empty without Git.
 */
export async function listBranches(root: string): Promise<Branch[]> {
  const out = await gitText(root, [
    "for-each-ref",
    "--format=%(refname)%00%(refname:short)%00%(symref)%00%(HEAD)",
    "refs/heads",
    "refs/remotes",
  ]);
  return (out ?? "")
    .split("\n")
    .map((line) => line.split("\0"))
    .filter(([ref, , symref, head]) => ref && !symref && head !== "*")
    .map(([ref, name]) => ({
      name: name!,
      ref: ref!,
      remote: ref!.startsWith("refs/remotes/"),
    }));
}

/**
 * The commit the old side comes from: HEAD, or where HEAD left the branch
 * `ref` (its merge base). Null when there is none.
 */
export async function baseCommit(
  root: string,
  ref: string | null,
): Promise<string | null> {
  const out = await gitText(
    root,
    ref ? ["merge-base", ref, "HEAD"] : ["rev-parse", "--verify", "-q", "HEAD"],
  );
  return out?.trim() || null;
}
