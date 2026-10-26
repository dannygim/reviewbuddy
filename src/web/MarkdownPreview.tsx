import DOMPurify from "dompurify";
import {
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Thread } from "../shared/api";
import { createThread } from "./api";
import {
  blockAt,
  blockForRange,
  blocks,
  createSlot,
  type LineRange,
  rangeOf,
  removeSlot,
} from "./blocks";
import { Composer } from "./Composer";
import { useReviewer } from "./context";
import { useColorScheme } from "./displayMode";
import { threadStore, useThreads } from "./store";
import { ThreadView } from "./Thread";

type Slot = {
  key: string;
  el: HTMLElement;
  threads: Thread[];
  composer: boolean;
};
const ORPHANS = "orphans";

// Stable React keys for blocks, so a slot's portal is not remounted.
const blockKeys = new WeakMap<Element, string>();
let nextBlockKey = 0;
const keyOf = (key: Element | string) => {
  if (typeof key === "string") return key;
  let value = blockKeys.get(key);
  if (!value) blockKeys.set(key, (value = `block-${nextBlockKey++}`));
  return value;
};

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
  const [slots, setSlots] = useState<Slot[]>([]);
  // Slot elements are reused per block, so portals (and a half-written
  // comment) survive re-renders caused by other people's comments.
  const slotEls = useRef(new Map<Element | string, HTMLElement>());

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

  // New HTML replaces every block, so old slots are gone with it.
  useLayoutEffect(() => {
    slotEls.current.clear();
    setSelection(null);
    setComposerOpen(false);
  }, [clean]);

  // Place threads (and the composer) after the block they belong to.
  useLayoutEffect(() => {
    const root = article.current;
    if (!root) return;
    const wanted = new Map<Element | string, Slot>();
    const slotFor = (key: Element | string) => {
      let slot = wanted.get(key);
      if (!slot) {
        let el = slotEls.current.get(key);
        if (!el || !el.isConnected) {
          el =
            typeof key === "string"
              ? Object.assign(document.createElement("div"), {
                  className: "preview-slot preview-orphans",
                })
              : createSlot(key as HTMLElement);
          if (typeof key === "string") root.append(el);
        }
        slot = { key: keyOf(key), el, threads: [], composer: false };
        wanted.set(key, slot);
      }
      return slot;
    };
    for (const thread of threads) {
      const block = blockForRange(root, {
        start: thread.startLine,
        end: thread.endLine,
      });
      slotFor(block ?? ORPHANS).threads.push(thread);
    }
    if (selection && composerOpen) {
      slotFor(blockForRange(root, selection) ?? ORPHANS).composer = true;
    }
    for (const [key, el] of slotEls.current) {
      if (!wanted.has(key) && el.isConnected) removeSlot(el);
    }
    slotEls.current = new Map([...wanted].map(([key, slot]) => [key, slot.el]));
    setSlots([...wanted.values()]);
  }, [clean, threads, selection, composerOpen]);

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
    if (!article.current || target.closest(".preview-slot, .block-add")) return;
    const block = blockAt(target, article.current);
    if (!block || !wrap.current) return;
    // Recomputed on every move: inserted comments shift blocks down.
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

  return (
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
      {slots.map((slot) =>
        createPortal(
          <>
            {slot.threads.map((thread) => (
              <ThreadView key={thread.id} thread={thread} />
            ))}
            {slot.composer && selection && (
              <Composer
                submitLabel="Comment"
                onCancel={clear}
                onSubmit={async (body) => {
                  threadStore.upsert(
                    await createThread({
                      path,
                      startLine: selection.start,
                      endLine: selection.end,
                      originView: "preview",
                      author: reviewer.nickname,
                      clientId: reviewer.clientId,
                      body,
                    }),
                  );
                  clear();
                }}
              />
            )}
          </>,
          slot.el,
          slot.key,
        ),
      )}
    </div>
  );
}
