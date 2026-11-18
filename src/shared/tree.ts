export type TreeNode = {
  name: string;
  path: string;
  children?: TreeNode[];
  /** An ignored file, or a folded directory of them (only the owner sees these). */
  ignored?: boolean;
};

// Tree order: directories before files at each level, then names compared
// case-insensitively, with ties broken by code unit so the order is total.
export function compareTreePaths(a: string, b: string): number {
  const as = a.split("/");
  const bs = b.split("/");
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const x = as[i]!;
    const y = bs[i]!;
    if (x === y) continue;
    const xIsDir = i < as.length - 1;
    const yIsDir = i < bs.length - 1;
    if (xIsDir !== yIsDir) return xIsDir ? -1 : 1;
    return compareNames(x, y);
  }
  return as.length - bs.length;
}

function compareNames(x: string, y: string): number {
  const lx = x.toLowerCase();
  const ly = y.toLowerCase();
  if (lx !== ly) return lx < ly ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Nests paths into a tree. `ignored` entries (GET /api/tree/ignored) are
 * merged in and marked; one ending in "/" is a folded directory, whose
 * entries come later, if at all.
 */
export function buildTree(paths: string[], ignored: string[] = []): TreeNode[] {
  const roots: TreeNode[] = [];
  const dirs = new Map<string, TreeNode[]>([["", roots]]);
  const marked = new Set(ignored);
  const all = new Set([...paths, ...ignored]);
  // Sorted paths visit the tree in pre-order, so children are appended in tree order.
  for (const entry of [...all].sort(compareTreePaths)) {
    const folded = entry.endsWith("/");
    const path = folded ? entry.slice(0, -1) : entry;
    const parts = path.split("/");
    let parent = "";
    for (const name of parts.slice(0, -1)) {
      const dir = parent ? `${parent}/${name}` : name;
      if (!dirs.has(dir)) {
        // "dist/pkg/" sorts before "dist/": a folded directory may come here first.
        const children: TreeNode[] = [];
        dirs
          .get(parent)!
          .push(
            marked.has(`${dir}/`)
              ? { name, path: dir, children, ignored: true }
              : { name, path: dir, children },
          );
        dirs.set(dir, children);
      }
      parent = dir;
    }
    const name = parts.at(-1)!;
    if (folded) {
      if (dirs.has(path)) continue;
      const children: TreeNode[] = [];
      dirs.get(parent)!.push({ name, path, children, ignored: true });
      dirs.set(path, children);
    } else {
      dirs
        .get(parent)!
        .push(
          marked.has(path) ? { name, path, ignored: true } : { name, path },
        );
    }
  }
  return roots;
}

/** Every directory above the given files: "a/b/c.md" gives "a" and "a/b". */
export function ancestorDirs(paths: Iterable<string>): Set<string> {
  const dirs = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    parts.forEach((_, i) => dirs.add(parts.slice(0, i + 1).join("/")));
  }
  return dirs;
}

/**
 * The README.md among a directory's children: README.md, else any case of
 * readme.md in tree order. Never an ignored one, to open it unasked.
 */
export function findReadme(children: TreeNode[]): string | null {
  const readmes = children.filter(
    (c) => !c.children && !c.ignored && c.name.toLowerCase() === "readme.md",
  );
  return (
    (readmes.find((c) => c.name === "README.md") ?? readmes[0])?.path ?? null
  );
}
