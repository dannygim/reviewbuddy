import { useEffect, useState } from "react";
import type { ChangedFile, FileDiff } from "../shared/api";
import { fetchDiff } from "./api";
import { DiffView } from "./DiffView";
import { CodeIcon, FileIcon } from "./icons";
import { MarkdownPreview } from "./MarkdownPreview";
import { CommentPaneButton } from "./Viewer";

/** Above this many changed lines, a file's diff waits for "Load diff". */
const LARGE = 500;

const STATUS_LABELS: Record<ChangedFile["status"], string | null> = {
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  modified: null,
};

const size = (f: ChangedFile) => (f.additions ?? 0) + (f.deletions ?? 0);

/**
 * Every uncommitted change, one card per file (docs/design/差分表示.md).
 * `reveal` opens a card and scrolls to it (a click in the changes tree).
 */
export function ChangesView({
  files,
  viewed,
  onViewed,
  reveal,
}: {
  files: ChangedFile[];
  viewed: ReadonlySet<string>;
  onViewed: (path: string, viewed: boolean) => void;
  reveal: { path: string } | null;
}) {
  // Cards the reader opened or closed, until their change changes again; the
  // rest follow Viewed and size.
  const [opened, setOpened] = useState<Map<string, boolean>>(() => new Map());
  const keyOf = (f: ChangedFile) => `${f.path}\0${f.version}`;
  const isOpen = (f: ChangedFile) =>
    opened.get(keyOf(f)) ?? (!viewed.has(f.path) && size(f) <= LARGE);
  const setOpen = (f: ChangedFile, open: boolean) =>
    setOpened((prev) => new Map(prev).set(keyOf(f), open));

  useEffect(() => {
    const file = files.find((f) => f.path === reveal?.path);
    if (!reveal || !file) return;
    setOpen(file, true);
    // After the card has opened.
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-diff-path="${CSS.escape(reveal.path)}"]`)
        ?.scrollIntoView({ block: "start" }),
    );
  }, [reveal]);

  const additions = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const deletions = files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  return (
    <section className="viewer changes">
      <header className="viewer-header">
        <span>
          {files.length} file{files.length === 1 ? "" : "s"} changed{" "}
          <span className="diff-count-add">+{additions}</span>{" "}
          <span className="diff-count-del">−{deletions}</span>
        </span>
        <span className="viewer-actions">
          <span className="muted" data-role="viewed-count">
            {files.filter((f) => viewed.has(f.path)).length} / {files.length}{" "}
            viewed
          </span>
          <CommentPaneButton />
        </span>
      </header>
      {files.length === 0 && (
        <p className="viewer-note">No uncommitted changes.</p>
      )}
      {files.map((file) => (
        <DiffCard
          key={file.path}
          file={file}
          open={isOpen(file)}
          onOpen={(open) => setOpen(file, open)}
          viewed={viewed.has(file.path)}
          onViewed={(value) => {
            onViewed(file.path, value);
            setOpen(file, !value);
          }}
        />
      ))}
    </section>
  );
}

type State = { diff: FileDiff } | { error: string } | null;

function DiffCard({
  file,
  open,
  onOpen,
  viewed,
  onViewed,
}: {
  file: ChangedFile;
  open: boolean;
  onOpen: (open: boolean) => void;
  viewed: boolean;
  onViewed: (viewed: boolean) => void;
}) {
  const [state, setState] = useState<State>(null);
  const [mode, setMode] = useState<"rich" | "source">("rich");

  // Fetched when opened, and again when the change changes; the old diff
  // stays until the new one arrives, so the scroll position is kept.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchDiff(file.path).then(
      (diff) => cancelled || setState({ diff }),
      (error: Error) => cancelled || setState({ error: error.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [open, file.path, file.version]);

  const diff = state && "diff" in state ? state.diff : null;
  const rich =
    diff?.kind === "text" &&
    diff.richHtml !== null &&
    file.status !== "deleted";
  const label = STATUS_LABELS[file.status];
  return (
    <article className="diff-card" data-diff-path={file.path}>
      <header className="diff-card-header">
        <button
          className="diff-card-toggle"
          aria-expanded={open}
          onClick={() => onOpen(!open)}
        >
          <span className="tree-twisty">{open ? "▾" : "▸"}</span>
          <span className="diff-card-path">
            {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
          </span>
        </button>
        {label && <span className="label">{label}</span>}
        <Counts file={file} />
        <span className="app-spacer" />
        {rich && open && (
          <span className="viewer-tabs" role="tablist">
            <button
              role="tab"
              aria-label="Source diff"
              aria-selected={mode === "source"}
              onClick={() => setMode("source")}
            >
              <CodeIcon />
            </button>
            <button
              role="tab"
              aria-label="Rich diff"
              aria-selected={mode === "rich"}
              onClick={() => setMode("rich")}
            >
              <FileIcon />
            </button>
          </span>
        )}
        <label className="diff-viewed">
          <input
            type="checkbox"
            checked={viewed}
            onChange={(event) => onViewed(event.target.checked)}
          />
          Viewed
        </label>
      </header>
      {open ? (
        <CardBody file={file} state={state} rich={rich && mode === "rich"} />
      ) : (
        !viewed &&
        size(file) > LARGE && (
          <p className="viewer-note">
            Large diffs are not loaded until asked.{" "}
            <button className="app-review" onClick={() => onOpen(true)}>
              Load diff
            </button>
          </p>
        )
      )}
    </article>
  );
}

export function Counts({ file }: { file: ChangedFile }) {
  if (file.additions === null) return <span className="muted">binary</span>;
  return (
    <span className="diff-counts">
      <span className="diff-count-add">+{file.additions}</span>{" "}
      <span className="diff-count-del">−{file.deletions}</span>
    </span>
  );
}

function CardBody({
  file,
  state,
  rich,
}: {
  file: ChangedFile;
  state: State;
  rich: boolean;
}) {
  if (!state) return <p className="viewer-note">Loading…</p>;
  if ("error" in state) return <p className="viewer-note">{state.error}</p>;
  const { diff } = state;
  if (diff.kind === "binary")
    return <p className="viewer-note">Binary file not shown.</p>;
  if (rich) return <MarkdownPreview path={file.path} html={diff.richHtml!} />;
  if (diff.changes.length === 0) {
    return <p className="viewer-note">No changes to the content.</p>;
  }
  return (
    <DiffView
      path={file.path}
      diff={diff}
      commentable={file.status !== "deleted"}
    />
  );
}
