import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Thread } from "../shared/api";
import { CommentIcon } from "./icons";
import { usePaneOpen } from "./panes";
import { stackTops } from "./stack";
import { lineRange } from "./Thread";

export type PaneItem = {
  key: string;
  /** The element whose top the item lines up with; null = after the content. */
  anchor: () => Element | null;
  /** The elements the item is about, lit up while it is active or hovered. */
  targets: () => Element[];
  /** The thread shown; null for the composer. */
  thread: Thread | null;
  node: ReactNode;
};

const GAP = 8;

/**
 * The content with its threads in a column on the right. Closed, the column
 * only shows a marker for each thread.
 *
 * The active thread (its card or its lines clicked) and the composer line up
 * with their content exactly; the cards before them move up to make room.
 */
export function CommentPane({
  items,
  active,
  onActive,
  children,
}: {
  items: PaneItem[];
  active: string | null;
  onActive: (key: string | null) => void;
  children: ReactNode;
}) {
  const columns = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const [open, setOpen] = usePaneOpen("commentPane");
  const [hovered, setHovered] = useState<string | null>(null);
  // A clicked card is scrolled to once it has moved beside its lines.
  const reveal = useRef<string | null>(null);
  const shown = open ? items : items.filter((item) => item.thread);
  const composer = items.find((item) => !item.thread);
  const current = composer?.key ?? active;

  // Starting a comment opens the pane (it stays closed if closed after).
  const composing = composer !== undefined;
  useEffect(() => {
    if (composing) setOpen(true);
  }, [composing]);

  // Positions are written to the cards directly: re-rendering every thread
  // whenever something above them changes height would be wasted work.
  useLayoutEffect(() => {
    const layout = () => {
      if (!columns.current || !content.current || !pane.current) return;
      const origin = columns.current.getBoundingClientRect().top;
      const end = content.current.offsetHeight;
      const cards = [...pane.current.children] as HTMLElement[];
      const placed = shown
        .map((item, i) => {
          const anchor = item.anchor();
          return {
            key: item.key,
            card: cards[i]!,
            wanted: anchor ? anchor.getBoundingClientRect().top - origin : end,
            height: cards[i]!.offsetHeight,
            order: i,
          };
        })
        .sort((a, b) => a.wanted - b.wanted || a.order - b.order);
      const pinned = placed.findIndex((p) => p.key === current);
      const tops = stackTops(placed, GAP, pinned);
      placed.forEach((p, i) => (p.card.style.top = `${tops[i]}px`));
      const last = placed.at(-1);
      pane.current.style.minHeight = last
        ? `${tops.at(-1)! + last.height}px`
        : "";
      if (pinned >= 0 && reveal.current === current) {
        // Moved again before getting there: the next layout waits instead.
        const card = placed[pinned]!.card;
        void Promise.all(card.getAnimations().map((a) => a.finished)).then(
          () => {
            if (reveal.current !== current) return;
            reveal.current = null;
            card.scrollIntoView({ block: "nearest" });
          },
          () => {},
        );
      }
    };
    layout();
    // The content and the cards change height (Mermaid, images, replies);
    // the positions written above change neither.
    const observer = new ResizeObserver(layout);
    observer.observe(content.current!);
    for (const card of pane.current!.children) observer.observe(card);
    return () => observer.disconnect();
  }, [shown, current]);

  // Light up what the active and the hovered threads are about.
  useLayoutEffect(() => {
    const lit = items
      .filter((item) => item.thread && [current, hovered].includes(item.key))
      .flatMap((item) => item.targets());
    for (const el of lit) el.setAttribute("data-comment-target", "");
    return () => {
      for (const el of lit) el.removeAttribute("data-comment-target");
    };
  }, [items, current, hovered]);

  // Clicking a thread's lines makes it active, the smallest thread where
  // several cover the click; clicking anywhere else makes none active.
  const onContentClick = (event: MouseEvent) => {
    if (window.getSelection()?.isCollapsed === false) return; // selecting text
    const target = event.target as Node;
    let hit: { key: string; size: number } | null = null;
    for (const item of items) {
      if (!item.thread) continue;
      const targets = item.targets();
      if (
        targets.some((el) => el.contains(target)) &&
        (!hit || targets.length < hit.size)
      )
        hit = { key: item.key, size: targets.length };
    }
    onActive(hit?.key ?? null);
  };

  const activate = (key: string) => {
    if (key === current) return;
    reveal.current = key;
    onActive(key);
  };

  return (
    <div
      ref={columns}
      className={open ? "viewer-columns" : "viewer-columns pane-closed"}
    >
      <div ref={content} className="viewer-content" onClick={onContentClick}>
        {children}
      </div>
      <div ref={pane} className="comment-pane">
        {shown.map(({ key, thread, node }) =>
          open ? (
            <div
              key={key}
              className={
                key === current ? "comment-card active" : "comment-card"
              }
              onClick={() => activate(key)}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(null)}
            >
              {node}
            </div>
          ) : (
            <button
              key={key}
              className="comment-marker"
              data-status={thread!.status}
              title={lineRange(thread!)}
              onClick={() => {
                setOpen(true);
                onActive(key);
              }}
            >
              <CommentIcon filled={thread!.status === "open"} />
            </button>
          ),
        )}
      </div>
    </div>
  );
}
