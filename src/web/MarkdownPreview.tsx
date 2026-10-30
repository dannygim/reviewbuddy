import DOMPurify from "dompurify";
import {
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createThread } from "./api";
import {
  blockAt,
  blockForRange,
  blocks,
  coveredBlocks,
  type LineRange,
  rangeOf,
} from "./blocks";
import { CommentPane, type PaneItem } from "./CommentPane";
import { Composer } from "./Composer";
import { useReviewer } from "./context";
import { useColorScheme } from "./displayMode";
import { threadStore, useThreads } from "./store";
import { ThreadView } from "./Thread";

export function MarkdownPreview({
  path,
  html,
}: {
  path: string;
  html: string;
}) {
  const reviewer = useReviewer();
  const all = useThreads();
  const threads = useMemo(
    () => all.filter((t) => t.path === path),
    [all, path],
  );
  const article = useRef<HTMLElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const clean = useMemo(
    () => DOMPurify.sanitize(html, { ADD_ATTR: ["target"] }),
    [html],
  );

  const [hover, setHover] = useState<{
    block: HTMLElement;
    top: number;
  } | null>(null);
  const [selection, setSelection] = useState<LineRange | null>(null);
  // Shown only after the mouse button is released (see CodeView).
  const [composerOpen, setComposerOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  const scheme = useColorScheme();

  // Mermaid is large, so it is only loaded for documents that need it.
  useEffect(() => {
    const nodes = [
      ...(article.current?.querySelectorAll<HTMLElement>(".mermaid") ?? []),
    ];
    if (nodes.length > 0) {
      void import("./mermaid").then(({ renderMermaid }) =>
        renderMermaid(nodes, scheme),
      );
    }
  }, [clean, scheme]);

  // New HTML replaces every block, so the selection is gone with it.
  useLayoutEffect(() => {
    setSelection(null);
    setComposerOpen(false);
  }, [clean]);

  // Highlight the selected blocks.
  useLayoutEffect(() => {
    const root = article.current;
    if (!root) return;
    for (const el of blocks(root)) {
      const r = rangeOf(el);
      el.classList.toggle(
        "preview-selected",
        selection !== null &&
          r.start >= selection.start &&
          r.end <= selection.end,
      );
    }
  }, [clean, selection]);

  const onMouseMove = (event: MouseEvent) => {
    const target = event.target as Element;
    if (!article.current || target.closest(".block-add")) return;
    const block = blockAt(target, article.current);
    if (!block || !wrap.current) return;
    // Recomputed on every move: diagrams and images shift blocks down.
    const top =
      block.getBoundingClientRect().top -
      wrap.current.getBoundingClientRect().top;
    if (block !== hover?.block || top !== hover.top) setHover({ block, top });
  };

  const onAdd = (event: MouseEvent) => {
    if (!hover) return;
    event.preventDefault();
    const range = rangeOf(hover.block);
    setSelection(
      event.shiftKey && selection
        ? {
            start: Math.min(selection.start, range.start),
            end: Math.max(selection.end, range.end),
          }
        : range,
    );
    setComposerOpen(false);
    window.addEventListener("mouseup", () => setComposerOpen(true), {
      once: true,
    });
  };

  // Plain "#fragment" links would replace the "#/doc/<path>" route.
  const onClick = (event: MouseEvent) => {
    const href = (event.target as Element).closest("a")?.getAttribute("href");
    if (href?.startsWith("#") && !href.startsWith("#/doc/"))
      event.preventDefault();
  };

  const clear = () => {
    setSelection(null);
    setComposerOpen(false);
  };

  // Threads (and the composer) line up with the block they belong to.
  const block = (range: LineRange) => () =>
    article.current ? blockForRange(article.current, range) : null;
  const covered = (range: LineRange) => () =>
    article.current ? coveredBlocks(article.current, range) : [];
  const items: PaneItem[] = threads.map((thread) => {
    const range = { start: thread.startLine, end: thread.endLine };
    return {
      key: thread.id,
      anchor: block(range),
      targets: covered(range),
      thread,
      node: <ThreadView thread={thread} />,
    };
  });
  if (selection && composerOpen) {
    items.push({
      key: "composer",
      anchor: block(selection),
      targets: covered(selection),
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
              originView: "preview",
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

  return (
    <CommentPane items={items} active={active} onActive={setActive}>
      <div
        ref={wrap}
        className="preview-wrap"
        onMouseMove={reviewer.readOnly ? undefined : onMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        <article
          ref={article}
          className="markdown"
          onClick={onClick}
          dangerouslySetInnerHTML={{ __html: clean }}
        />
        {hover && !reviewer.readOnly && (
          <button
            className="block-add"
            style={{ top: hover.top }}
            title="Comment on this block (Shift+click to extend)"
            onMouseDown={onAdd}
          >
            +
          </button>
        )}
      </div>
    </CommentPane>
  );
}
