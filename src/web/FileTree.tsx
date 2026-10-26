import { useEffect, useMemo, useState } from "react";
import {
  ancestorDirs,
  buildTree,
  findReadme,
  type TreeNode,
} from "../shared/tree";
import { CommentIcon } from "./icons";
import { initials } from "./presence";

export type ThreadCounts = { open: number; resolved: number };

type Props = {
  files: string[];
  selected: string | null;
  /** Number of open and resolved threads per file. */
  threads: Map<string, ThreadCounts>;
  /** Nicknames of the other people viewing each file. */
  viewers: Map<string, string[]>;
  /** Files that just changed on disk (highlighted briefly). */
  changed: ReadonlySet<string>;
  onSelect: (path: string) => void;
};

export function FileTree(props: Props) {
  const { files, selected, threads, viewers, changed, onSelect } = props;
  const tree = useMemo(() => buildTree(files), [files]);
  const dirsWithOpen = useMemo(
    () =>
      ancestorDirs(
        [...threads].filter(([, c]) => c.open > 0).map(([path]) => path),
      ),
    [threads],
  );
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
        threads={threads}
        dirsWithOpen={dirsWithOpen}
        viewers={viewers}
        changed={changed}
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
  threads: Map<string, ThreadCounts>;
  dirsWithOpen: ReadonlySet<string>;
  viewers: Map<string, string[]>;
  changed: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
};

function TreeList(props: ListProps) {
  const { nodes, depth, expanded, selected, threads, dirsWithOpen } = props;
  const { viewers, changed } = props;
  const { onToggle, onSelect } = props;
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
              onClick={() => {
                const opening = !expanded.has(node.path);
                onToggle(node.path);
                const inside = selected?.startsWith(`${node.path}/`);
                const readme = opening && !inside && findReadme(node.children!);
                if (readme) onSelect(readme);
              }}
            >
              <span className="tree-twisty">
                {expanded.has(node.path) ? "▾" : "▸"}
              </span>
              {node.name}
              {!expanded.has(node.path) && dirsWithOpen.has(node.path) && (
                <span className="tree-dot" title="Open threads inside" />
              )}
            </button>
            {expanded.has(node.path) && (
              <TreeList {...props} nodes={node.children} depth={depth + 1} />
            )}
          </li>
        ) : (
          <li key={node.path}>
            <button
              className={
                changed.has(node.path) ? "tree-file tree-changed" : "tree-file"
              }
              data-path={node.path}
              aria-current={node.path === selected ? "page" : undefined}
              style={indent}
              onClick={() => onSelect(node.path)}
            >
              <span className="tree-twisty" />
              {node.name}
              {viewers.get(node.path)?.map((name) => (
                <span key={name} className="avatar" title={name}>
                  {initials(name)}
                </span>
              ))}
              <ThreadMark counts={threads.get(node.path)} />
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

function ThreadMark({ counts }: { counts: ThreadCounts | undefined }) {
  if (counts?.open) {
    return (
      <span
        className="tree-badge"
        title={`${counts.open} open thread${counts.open === 1 ? "" : "s"}`}
      >
        <CommentIcon filled />
        {counts.open}
      </span>
    );
  }
  if (counts?.resolved) {
    return (
      <span className="tree-resolved" title="Resolved threads only">
        <CommentIcon />
      </span>
    );
  }
  return null;
}
