export type TreeNode = { name: string; path: string; children?: TreeNode[] };

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

export function buildTree(paths: string[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const dirs = new Map<string, TreeNode[]>([["", roots]]);
  // Sorted paths visit the tree in pre-order, so children are appended in tree order.
  for (const path of [...paths].sort(compareTreePaths)) {
    const parts = path.split("/");
    let parent = "";
    for (const name of parts.slice(0, -1)) {
      const dir = parent ? `${parent}/${name}` : name;
      if (!dirs.has(dir)) {
        const children: TreeNode[] = [];
        dirs.get(parent)!.push({ name, path: dir, children });
        dirs.set(dir, children);
      }
      parent = dir;
    }
    dirs.get(parent)!.push({ name: parts.at(-1)!, path });
  }
  return roots;
}
