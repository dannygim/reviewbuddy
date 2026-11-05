import { useMemo, useRef, useState } from "react";
import type { FileDiff } from "../shared/api";
import { createThread } from "./api";
import { CommentPane, type PaneItem } from "./CommentPane";
import { Composer } from "./Composer";
import { useReviewer } from "./context";
import { type DiffRow, diffRows, type Revealed } from "./diffRows";
import { threadStore, useThreads } from "./store";
import { ThreadView } from "./Thread";

type TextDiff = Extract<FileDiff, { kind: "text" }>;
type Selection = { anchor: number; start: number; end: number };

/** Hidden unchanged lines revealed per click, unless fewer are left. */
const STEP = 20;

/**
 * A unified diff with old and new line numbers (docs/design/差分表示.md).
 * Lines that exist in the new file can be commented on, by their new line
 * numbers, as in CodeView.
 */
export function DiffView({
  path,
  diff,
  commentable,
}: {
  path: string;
  diff: TextDiff;
  /** False for a deleted file: no new lines and no comments. */
  commentable: boolean;
}) {
  const reviewer = useReviewer();
  const all = useThreads();
  const [revealed, setRevealed] = useState<Revealed>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const latest = useRef<Selection | null>(null);
  const table = useRef<HTMLTableElement>(null);

  const rows = useMemo(
    () =>
      diffRows(
        diff.changes,
        diff.oldLines.length,
        diff.newLines.length,
        revealed,
      ),
    [diff, revealed],
  );
  const shown = useMemo(
    () =>
      rows.flatMap((r) =>
        r.type === "context" || r.type === "insert" ? [r.new] : [],
      ),
    [rows],
  );

  const reveal = (gap: number, side: "top" | "bottom", count: number) =>
    setRevealed((prev) => {
      const current = prev[gap] ?? { top: 0, bottom: 0 };
      return { ...prev, [gap]: { ...current, [side]: current[side] + count } };
    });

  const select = (line: number, extend: boolean) => {
    const anchor = extend && selection ? selection.anchor : line;
    const next = {
      anchor,
      start: Math.min(anchor, line),
      end: Math.max(anchor, line),
    };
    latest.current = next;
    setSelection(next);
  };

  const clear = () => {
    latest.current = null;
    setSelection(null);
    setComposerOpen(false);
  };

  // Comments line up with the first shown line of their range.
  const firstShown = (start: number, end: number) =>
    shown.find((n) => n >= start && n <= end);
  const row = (line: number) => () =>
    table.current?.querySelector(`tr[data-new="${line}"]`) ?? null;
  const lines = (start: number, end: number) => () =>
    [
      ...(table.current?.querySelectorAll<HTMLElement>("tr[data-new]") ?? []),
    ].filter((tr) => {
      const n = Number(tr.dataset.new);
      return n >= start && n <= end;
    });

  const items: PaneItem[] = all.flatMap((thread) => {
    if (thread.path !== path) return [];
    const first = firstShown(thread.startLine, thread.endLine);
    if (first === undefined) return [];
    return [
      {
        key: thread.id,
        anchor: row(first),
        targets: lines(thread.startLine, thread.endLine),
        thread,
        node: <ThreadView thread={thread} />,
      },
    ];
  });
  if (selection && composerOpen) {
    items.push({
      key: "composer",
      anchor: row(selection.start),
      targets: lines(selection.start, selection.end),
      thread: null,
      node: (
        <Composer
          submitLabel="Comment"
          onCancel={clear}
          onSubmit={async (body) => {
            const thread = await createThread({
              path,
              startLine: selection.start,
              endLine: selection.end,
              originView: "source",
              author: reviewer.nickname,
              clientId: reviewer.clientId,
              body,
            });
            threadStore.upsert(thread);
            setActive(thread.id);
            clear();
          }}
        />
      ),
    });
  }

  const canSelect = commentable && !reviewer.readOnly;
  const newNumber = (line: number) => (
    <td
      className="code-ln"
      onMouseDown={
        canSelect
          ? (event) => {
              event.preventDefault(); // no text selection while dragging
              select(line, event.shiftKey);
              setDragging(true);
              window.addEventListener(
                "mouseup",
                () => {
                  setDragging(false);
                  setComposerOpen(latest.current !== null);
                },
                { once: true },
              );
            }
          : undefined
      }
      onMouseEnter={dragging ? () => select(line, true) : undefined}
    >
      {line}
    </td>
  );

  const body = rows.map((r) => {
    switch (r.type) {
      case "hunk":
        return (
          <tr key={`hunk-${r.gap}`} className="diff-hunk">
            <td colSpan={2} className="diff-expand">
              <ExpandButtons
                row={r}
                last={r.gap === diff.changes.length}
                onReveal={reveal}
              />
            </td>
            <td className="code-src">{r.header}</td>
          </tr>
        );
      case "delete":
        return (
          <tr key={`old-${r.old}`} className="diff-del" data-old={r.old}>
            <td className="code-ln">{r.old}</td>
            <td className="code-ln" />
            <Code sign="-" html={diff.oldLines[r.old - 1]!} />
          </tr>
        );
      default: {
        const selected =
          selection !== null &&
          r.new >= selection.start &&
          r.new <= selection.end;
        const classes = [
          r.type === "insert" && "diff-add",
          selected && "selected",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <tr
            key={`new-${r.new}`}
            className={classes || undefined}
            data-new={r.new}
            data-old={r.type === "context" ? r.old : undefined}
          >
            <td className="code-ln">{r.type === "context" ? r.old : ""}</td>
            {newNumber(r.new)}
            <Code
              sign={r.type === "insert" ? "+" : " "}
              html={diff.newLines[r.new - 1]!}
            />
          </tr>
        );
      }
    }
  });

  const content = (
    <table
      ref={table}
      className={canSelect ? "code diff commentable" : "code diff"}
    >
      <tbody>{body}</tbody>
    </table>
  );
  if (!commentable) return content;
  return (
    <CommentPane items={items} active={active} onActive={setActive}>
      {content}
    </CommentPane>
  );
}

function Code({ sign, html }: { sign: string; html: string }) {
  // Server-rendered: Shiki tokens with escaped text. The sign is drawn by CSS
  // so that copying the code leaves it out.
  return (
    <td
      className="code-src"
      data-sign={sign}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ExpandButtons({
  row,
  last,
  onReveal,
}: {
  row: Extract<DiffRow, { type: "hunk" }>;
  last: boolean;
  onReveal: (gap: number, side: "top" | "bottom", count: number) => void;
}) {
  if (row.hidden === 0) return null;
  if (row.hidden <= STEP) {
    // Above the first change there is no hunk to extend down: extend its own up.
    const side = row.gap === 0 ? "bottom" : "top";
    return (
      <button
        aria-label="Expand all"
        title={`Show ${row.hidden} hidden lines`}
        onClick={() => onReveal(row.gap, side, row.hidden)}
      >
        ↕
      </button>
    );
  }
  return (
    <>
      {row.gap > 0 && (
        <button
          aria-label="Expand down"
          onClick={() => onReveal(row.gap, "top", STEP)}
        >
          ↓
        </button>
      )}
      {!last && (
        <button
          aria-label="Expand up"
          onClick={() => onReveal(row.gap, "bottom", STEP)}
        >
          ↑
        </button>
      )}
    </>
  );
}
