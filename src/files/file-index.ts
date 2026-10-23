import ignore, { type Ignore } from "ignore";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compareTreePaths } from "../shared/tree";

export type ListOptions = { exclude?: string[] };

export async function listFiles(
  root: string,
  options: ListOptions = {},
): Promise<string[]> {
  const exclude = ignore().add(options.exclude ?? []);
  const paths = (await isInsideGitWorkTree(root))
    ? await gitFiles(root)
    : walkFiles(root);
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

async function run(args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    return (await proc.exited) === 0 ? out : null;
  } catch {
    return null; // `git` is not installed
  }
}

async function isInsideGitWorkTree(root: string): Promise<boolean> {
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

type Rules = { base: string; ig: Ignore };

// Walks a directory that is not in a Git work tree, applying each level's
// .gitignore like Git: deeper files take precedence, and nothing inside an
// ignored directory is listed.
function walkFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string, rules: Rules[]) => {
    const abs = join(root, dir);
    const own = readGitignore(join(abs, ".gitignore"));
    const scoped = own ? [...rules, { base: dir, ig: own }] : rules;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== ".git" && !isIgnored(`${path}/`, scoped))
          visit(path, scoped);
      } else if (!isIgnored(path, scoped)) {
        files.push(path);
      }
    }
  };
  visit("", []);
  return files;
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
