import { useEffect, useMemo, useState } from "react";
import { buildTree, type TreeNode } from "../shared/tree";

type Props = {
  files: string[];
  selected: string | null;
  onSelect: (path: string) => void;
};

export function FileTree({ files, selected, onSelect }: Props) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Reveal the selected file, e.g. when it was opened from a shared link.
  useEffect(() => {
    if (!selected) return;
    const parts = selected.split("/").slice(0, -1);
    const ancestors = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    setExpanded((prev) =>
      ancestors.every((dir) => prev.has(dir))
        ? prev
        : new Set([...prev, ...ancestors]),
    );
  }, [selected]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <nav className="tree" aria-label="Files">
      <TreeList
        nodes={tree}
        depth={0}
        expanded={expanded}
        selected={selected}
        onToggle={toggle}
        onSelect={onSelect}
      />
    </nav>
  );
}

type ListProps = {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
};

function TreeList(props: ListProps) {
  const { nodes, depth, expanded, selected, onToggle, onSelect } = props;
  const indent = { paddingLeft: `${0.5 + depth}rem` };
  return (
    <ul>
      {nodes.map((node) =>
        node.children ? (
          <li key={node.path}>
            <button
              className="tree-dir"
              data-path={node.path}
              aria-expanded={expanded.has(node.path)}
              style={indent}
              onClick={() => onToggle(node.path)}
            >
              <span className="tree-twisty">
                {expanded.has(node.path) ? "▾" : "▸"}
              </span>
              {node.name}
            </button>
            {expanded.has(node.path) && (
              <TreeList {...props} nodes={node.children} depth={depth + 1} />
            )}
          </li>
        ) : (
          <li key={node.path}>
            <button
              className="tree-file"
              data-path={node.path}
              aria-current={node.path === selected ? "page" : undefined}
              style={indent}
              onClick={() => onSelect(node.path)}
            >
              <span className="tree-twisty" />
              {node.name}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}
