import { type ReactNode, useMemo, useRef, useState } from "react";
import type { Thread } from "../shared/api";
import { createThread } from "./api";
import { Composer } from "./Composer";
import { useReviewer } from "./context";
import { threadStore, useThreads } from "./store";
import { ThreadView } from "./Thread";

type Selection = { anchor: number; start: number; end: number };

/**
 * Source lines with a line-number gutter. Click a number to select a line,
 * Shift+click or drag to select a range, then comment below it.
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
  // The composer only moves once the mouse button is released: moving it
  // while the button is down shifts the rows under the pointer, which would
  // extend the selection to whatever row slides in.
  const [composerLine, setComposerLine] = useState<number | null>(null);
  const latest = useRef<Selection | null>(null);

  // Threads are shown under their last line; ones past the end go last.
  const threadsByLine = useMemo(() => {
    const map = new Map<number, Thread[]>();
    for (const thread of all) {
      if (thread.path !== path) continue;
      const line = Math.min(thread.endLine, lineHtml.length);
      map.set(line, [...(map.get(line) ?? []), thread]);
    }
    return map;
  }, [all, path, lineHtml.length]);

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
    setComposerLine(null);
  };

  const rows: ReactNode[] = [];
  lineHtml.forEach((html, i) => {
    const line = i + 1;
    const selected =
      selection !== null && line >= selection.start && line <= selection.end;
    rows.push(
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
                      setComposerLine(latest.current?.end ?? null);
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
      </tr>,
    );
    for (const thread of threadsByLine.get(line) ?? []) {
      rows.push(
        <tr key={thread.id} className="code-inline">
          <td colSpan={2}>
            <ThreadView thread={thread} />
          </td>
        </tr>,
      );
    }
    if (selection && line === composerLine) {
      rows.push(
        <tr key="composer" className="code-inline">
          <td colSpan={2}>
            <Composer
              submitLabel="Comment"
              onCancel={clear}
              onSubmit={async (body) => {
                threadStore.upsert(
                  await createThread({
                    path,
                    startLine: selection.start,
                    endLine: selection.end,
                    originView: "source",
                    author: reviewer.nickname,
                    clientId: reviewer.clientId,
                    body,
                  }),
                );
                clear();
              }}
            />
          </td>
        </tr>,
      );
    }
  });

  return (
    <table className={reviewer.readOnly ? "code" : "code commentable"}>
      <tbody>{rows}</tbody>
    </table>
  );
}
