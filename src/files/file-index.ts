import ignore, { type Ignore } from "ignore";
import {
  type Dirent,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import { compareTreePaths } from "../shared/tree";

export type ListOptions = { exclude?: string[] };

export async function listFiles(
  root: string,
  options: ListOptions = {},
): Promise<string[]> {
  const exclude = ignore().add(options.exclude ?? []);
  const paths = (await isInsideGitWorkTree(root))
    ? await gitFiles(root)
    : walk(root).files;
  return paths
    .filter((path) => !isDotGit(path) && !exclude.ignores(path))
    .sort(compareTreePaths);
}

export class FileIndex {
  #paths: string[];
  #set: Set<string>;

  private constructor(
    readonly root: string,
    private readonly options: ListOptions,
    paths: string[],
  ) {
    this.#paths = paths;
    this.#set = new Set(paths);
  }

  static async create(
    root: string,
    options: ListOptions = {},
  ): Promise<FileIndex> {
    return new FileIndex(root, options, await listFiles(root, options));
  }

  paths(): string[] {
    return this.#paths;
  }

  has(path: string): boolean {
    return this.#set.has(path);
  }

  /** Whether a path is never listed: inside .git/ or matched by viewer.exclude. */
  excludes(path: string): boolean {
    return (
      isDotGit(path) ||
      ignore()
        .add(this.options.exclude ?? [])
        .ignores(path)
    );
  }

  /**
   * Files left out of the list by .gitignore, with ignored directories folded
   * into one "dir/" entry, in tree order (docs/design/ファイル一覧と表示.md).
   */
  async listIgnored(): Promise<string[]> {
    const paths = (await isInsideGitWorkTree(this.root))
      ? await gitIgnored(this.root)
      : walk(this.root).ignored;
    return paths.filter((path) => !this.excludes(path)).sort(compareTreePaths);
  }

  /**
   * The entries directly in a folded directory ("dir/"), directories ending
   * in "/" and symlinks as files, in tree order. Null unless `dir` is a
   * directory inside the root, reached without symlinks, with no listed file.
   */
  listIgnoredDir(dir: string): string[] | null {
    if (
      !dir.endsWith("/") ||
      !isPlainPath(dir.slice(0, -1)) ||
      this.excludes(dir) ||
      this.#paths.some((path) => path.startsWith(dir))
    ) {
      return null;
    }
    const abs = join(this.root, dir);
    let entries: Dirent[];
    try {
      if (realpathSync(abs) !== abs.slice(0, -1)) return null;
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return null; // missing or not a directory
    }
    return entries
      .map((entry) => dir + entry.name + (entry.isDirectory() ? "/" : ""))
      .filter((path) => !this.excludes(path))
      .sort(compareTreePaths);
  }

  /**
   * Whether a path names an ignored file: not listed, not excluded, and a
   * file inside the root reached without symlinked directories. Asks no Git,
   * so a file added since the last refresh counts too. The root must be a
   * real path.
   */
  isIgnoredFile(path: string): boolean {
    if (!isPlainPath(path) || this.has(path) || this.excludes(path)) {
      return false;
    }
    const abs = join(this.root, path);
    try {
      if (realpathSync(dirname(abs)) !== dirname(abs)) return false;
      const real = realpathSync(abs);
      return real.startsWith(this.root + sep) && !statSync(real).isDirectory();
    } catch {
      return false;
    }
  }

  /** Re-lists the files and returns whether the list changed. */
  async refresh(): Promise<boolean> {
    const next = await listFiles(this.root, this.options);
    const changed =
      next.length !== this.#paths.length ||
      next.some((path, i) => path !== this.#paths[i]);
    if (changed) {
      this.#paths = next;
      this.#set = new Set(next);
    }
    return changed;
  }
}

function isDotGit(path: string): boolean {
  return path === ".git" || path.startsWith(".git/");
}

/** A relative POSIX path with no empty, "." or ".." part. */
function isPlainPath(path: string): boolean {
  return path
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== "..");
}

async function run(args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? out : null;
  } catch {
    return null; // `git` is not installed
  }
}

export async function isInsideGitWorkTree(root: string): Promise<boolean> {
  const out = await run([
    "git",
    "-C",
    root,
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  return out?.trim() === "true";
}

async function gitFiles(root: string): Promise<string[]> {
  const out = await run([
    "git",
    "-C",
    root,
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const paths = new Set((out ?? "").split("\0").filter(Boolean));
  // ls-files also reports files deleted from the work tree and submodule directories.
  return [...paths].filter((path) => {
    const stat = lstatSync(join(root, path), { throwIfNoEntry: false });
    return stat !== undefined && !stat.isDirectory();
  });
}

// Only ignored paths, with ignored directories folded ("dist/").
async function gitIgnored(root: string): Promise<string[]> {
  const out = await run([
    "git",
    "--no-optional-locks",
    "-C",
    root,
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
    "--no-empty-directory",
    "-z",
  ]);
  return (out ?? "").split("\0").filter(Boolean);
}

type Rules = { base: string; ig: Ignore };

// Walks a directory that is not in a Git work tree, applying each level's
// .gitignore like Git: deeper files take precedence, and nothing inside an
// ignored directory is listed. Ignored paths are kept apart, with ignored
// directories folded ("dist/").
function walk(root: string): { files: string[]; ignored: string[] } {
  const files: string[] = [];
  const ignored: string[] = [];
  const visit = (dir: string, rules: Rules[]) => {
    const abs = join(root, dir);
    const own = readGitignore(join(abs, ".gitignore"));
    const scoped = own ? [...rules, { base: dir, ig: own }] : rules;
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return; // unreadable or gone (e.g. deleted while being watched)
    }
    for (const entry of entries) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === ".git") continue;
        if (isIgnored(`${path}/`, scoped)) ignored.push(`${path}/`);
        else visit(path, scoped);
      } else {
        (isIgnored(path, scoped) ? ignored : files).push(path);
      }
    }
  };
  visit("", []);
  return { files, ignored };
}

function readGitignore(path: string): Ignore | null {
  try {
    return ignore().add(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isIgnored(path: string, rules: Rules[]): boolean {
  let ignored = false;
  for (const { base, ig } of rules) {
    const result = ig.test(base ? path.slice(base.length + 1) : path);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}
