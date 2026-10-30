import { useMemo, useRef, useState } from "react";
import { createThread } from "./api";
import { CommentPane, type PaneItem } from "./CommentPane";
import { Composer } from "./Composer";
import { useReviewer } from "./context";
import { threadStore, useThreads } from "./store";
import { ThreadView } from "./Thread";

type Selection = { anchor: number; start: number; end: number };

/**
 * Source lines with a line-number gutter. Click a number to select a line,
 * Shift+click or drag to select a range, then comment beside it.
 */
export function CodeView({
  path,
  lineHtml,
}: {
  path: string;
  lineHtml: string[];
}) {
  const reviewer = useReviewer();
  const all = useThreads();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  // The composer opens once the mouse button is released, not while a range
  // is still being dragged.
  const [composerOpen, setComposerOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const latest = useRef<Selection | null>(null);
  const table = useRef<HTMLTableElement>(null);

  const threads = useMemo(
    () => all.filter((t) => t.path === path),
    [all, path],
  );

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

  // Lines past the end (the file got shorter) use the last line.
  const row = (line: number) => () =>
    table.current?.querySelector(
      `tr[data-line="${Math.min(line, lineHtml.length)}"]`,
    ) ?? null;
  const lines = (start: number, end: number) => () => {
    const all = [...(table.current?.rows ?? [])];
    return all.slice(
      Math.min(start, all.length) - 1,
      Math.min(end, all.length),
    );
  };

  const items: PaneItem[] = threads.map((thread) => ({
    key: thread.id,
    anchor: row(thread.startLine),
    targets: lines(thread.startLine, thread.endLine),
    thread,
    node: <ThreadView thread={thread} />,
  }));
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

  const rows = lineHtml.map((html, i) => {
    const line = i + 1;
    const selected =
      selection !== null && line >= selection.start && line <= selection.end;
    return (
      <tr
        key={`line-${line}`}
        data-line={line}
        className={selected ? "selected" : undefined}
      >
        <td
          className="code-ln"
          onMouseDown={
            reviewer.readOnly
              ? undefined
              : (event) => {
                  event.preventDefault(); // no text selection while dragging
                  select(line, event.shiftKey);
                  setDragging(true);
                  // Registered here, not in an effect, so a quick click's
                  // mouseup cannot arrive before the listener exists.
                  window.addEventListener(
                    "mouseup",
                    () => {
                      setDragging(false);
                      setComposerOpen(latest.current !== null);
                    },
                    { once: true },
                  );
                }
          }
          onMouseEnter={dragging ? () => select(line, true) : undefined}
        >
          {line}
        </td>
        {/* Server-rendered: Shiki tokens with escaped text. */}
        <td className="code-src" dangerouslySetInnerHTML={{ __html: html }} />
      </tr>
    );
  });

  return (
    <CommentPane items={items} active={active} onActive={setActive}>
      <table
        ref={table}
        className={reviewer.readOnly ? "code" : "code commentable"}
      >
        <tbody>{rows}</tbody>
      </table>
    </CommentPane>
  );
}
