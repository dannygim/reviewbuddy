import { useMemo, useState } from "react";
import type { ChangedFile } from "../shared/api";
import { buildTree, type TreeNode } from "../shared/tree";
import { Counts } from "./ChangesView";

const LETTERS: Record<ChangedFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

/**
 * The changed files as a tree, every directory expanded at first. A click on
 * a file shows its card in the Changes view.
 */
export function ChangesTree({
  files,
  viewed,
  onSelect,
}: {
  files: ChangedFile[];
  viewed: ReadonlySet<string>;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files.map((f) => f.path)), [files]);
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const list = (nodes: TreeNode[], depth: number) => (
    <ul>
      {nodes.map((node) => {
        const indent = { paddingLeft: `${0.5 + depth}rem` };
        if (node.children) {
          const open = !collapsed.has(node.path);
          return (
            <li key={node.path}>
              <button
                className="tree-dir"
                data-path={node.path}
                aria-expanded={open}
                style={indent}
                onClick={() => toggle(node.path)}
              >
                <span className="tree-twisty">{open ? "▾" : "▸"}</span>
                {node.name}
              </button>
              {open && list(node.children, depth + 1)}
            </li>
          );
        }
        const file = byPath.get(node.path)!;
        const seen = viewed.has(node.path);
        return (
          <li key={node.path}>
            <button
              className={seen ? "tree-file tree-viewed" : "tree-file"}
              data-path={node.path}
              style={indent}
              title={seen ? "Viewed" : undefined}
              onClick={() => onSelect(node.path)}
            >
              <span className="tree-status" data-status={file.status}>
                {LETTERS[file.status]}
              </span>
              {node.name}
              {seen && <span className="tree-check">✓</span>}
              <Counts file={file} />
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav className="tree" aria-label="Changed files">
      {list(tree, 0)}
    </nav>
  );
}
