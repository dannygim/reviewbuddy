// Helpers for the source-mapped blocks of a Markdown preview: elements with
// data-src-start / data-src-end (1-based, inclusive) from the server renderer.

export type LineRange = { start: number; end: number };

export function rangeOf(el: Element): LineRange {
  return {
    start: Number(el.getAttribute("data-src-start")),
    end: Number(el.getAttribute("data-src-end")),
  };
}

export function blocks(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-src-start]")];
}

/** The innermost block at or around `target`, inside `root`. */
export function blockAt(target: Element, root: Element): HTMLElement | null {
  const block = target.closest<HTMLElement>("[data-src-start]");
  return block && root.contains(block) ? block : null;
}

/**
 * Where a comment on `range` belongs: the smallest block that contains the
 * whole range, else the smallest of the blocks that overlap it and start
 * first, so the comment lines up with the start of the range.
 */
export function blockForRange(
  root: Element,
  range: LineRange,
): HTMLElement | null {
  const span = (el: Element) => rangeOf(el).end - rangeOf(el).start;
  const overlapping = blocks(root).filter((el) => {
    const r = rangeOf(el);
    return r.start <= range.end && range.start <= r.end;
  });
  const whole = overlapping.filter((el) => {
    const r = rangeOf(el);
    return r.start <= range.start && range.end <= r.end;
  });
  const first = Math.min(...overlapping.map((el) => rangeOf(el).start));
  const pick = (list: HTMLElement[]) =>
    list.reduce<HTMLElement | null>(
      (best, el) => (best === null || span(el) <= span(best) ? el : best),
      null,
    );
  return (
    pick(whole) ?? pick(overlapping.filter((el) => rangeOf(el).start === first))
  );
}

/**
 * The blocks a comment on `range` is about: the blocks inside the range, else
 * the one it belongs to (a range within a single block).
 */
export function coveredBlocks(root: Element, range: LineRange): HTMLElement[] {
  const inside = blocks(root).filter((el) => {
    const r = rangeOf(el);
    return range.start <= r.start && r.end <= range.end;
  });
  const one = blockForRange(root, range);
  return inside.length > 0 ? inside : one ? [one] : [];
}
