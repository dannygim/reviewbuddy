import { useEffect, useMemo, useState } from "react";
import {
  ancestorDirs,
  buildTree,
  findReadme,
  type TreeNode,
} from "../shared/tree";
import { CommentIcon } from "./icons";
import type { IgnoredEntries } from "./ignoredFiles";
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
  /** Ignored files to merge in (the owner's, when shown), else null. */
  ignored: IgnoredEntries | null;
  onSelect: (path: string) => void;
};

export function FileTree(props: Props) {
  const { files, selected, threads, viewers, changed, ignored, onSelect } =
    props;
  const tree = useMemo(
    () => buildTree(files, ignored?.paths ?? []),
    [files, ignored?.paths],
  );
  const foldedDirs = useMemo(() => {
    const dirs = new Set<string>();
    const visit = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (!node.children) continue;
        if (node.ignored) dirs.add(node.path);
        visit(node.children);
      }
    };
    visit(tree);
    return dirs;
  }, [tree]);
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

  // Load the open folded directories, also after they were listed again.
  useEffect(() => {
    for (const dir of expanded) {
      if (foldedDirs.has(dir)) ignored?.open(`${dir}/`);
    }
  }, [expanded, foldedDirs, ignored]);

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
        isLoading={(dir) =>
          foldedDirs.has(dir) && !ignored?.isLoaded(`${dir}/`)
        }
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
  /** A folded directory whose entries have not arrived yet. */
  isLoading: (dir: string) => boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
};

function TreeList(props: ListProps) {
  const { nodes, depth, expanded, selected, threads, dirsWithOpen } = props;
  const { viewers, changed, isLoading } = props;
  const { onToggle, onSelect } = props;
  const indent = { paddingLeft: `${0.5 + depth}rem` };
  return (
    <ul>
      {nodes.map((node) =>
        node.children ? (
          <li key={node.path}>
            <button
              className={node.ignored ? "tree-dir tree-ignored" : "tree-dir"}
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
            {expanded.has(node.path) &&
              (isLoading(node.path) ? (
                <p
                  className="tree-loading muted"
                  // Where the entries' names will start (indent and twisty).
                  style={{ paddingLeft: `calc(${1.5 + depth}rem + 1.25em)` }}
                >
                  Loading…
                </p>
              ) : (
                <TreeList {...props} nodes={node.children} depth={depth + 1} />
              ))}
          </li>
        ) : (
          <li key={node.path}>
            <button
              className={[
                "tree-file",
                changed.has(node.path) && "tree-changed",
                node.ignored && "tree-ignored",
              ]
                .filter(Boolean)
                .join(" ")}
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
