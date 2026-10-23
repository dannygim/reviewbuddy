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
 * whole range, else the smallest block containing its last line.
 */
export function blockForRange(
  root: Element,
  range: LineRange,
): HTMLElement | null {
  const span = (el: Element) => rangeOf(el).end - rangeOf(el).start;
  const holding = blocks(root).filter((el) => {
    const r = rangeOf(el);
    return r.start <= range.end && range.end <= r.end;
  });
  const whole = holding.filter((el) => rangeOf(el).start <= range.start);
  const pick = (list: HTMLElement[]) =>
    list.reduce<HTMLElement | null>(
      (best, el) => (best === null || span(el) <= span(best) ? el : best),
      null,
    );
  return pick(whole) ?? pick(holding);
}

/**
 * Creates the element that holds comments shown after `block`, keeping the
 * HTML valid: a row after a table row, the end of a list item, else a sibling.
 */
export function createSlot(block: HTMLElement): HTMLElement {
  if (block.tagName === "TR") {
    const row = document.createElement("tr");
    row.className = "preview-slot";
    const cell = document.createElement("td");
    cell.colSpan = Math.max(1, block.children.length);
    row.append(cell);
    block.after(row);
    return cell;
  }
  const slot = document.createElement("div");
  slot.className = "preview-slot";
  if (block.tagName === "LI") block.append(slot);
  else block.after(slot);
  return slot;
}

export function removeSlot(slot: HTMLElement): void {
  (slot.tagName === "TD" ? slot.parentElement! : slot).remove();
}
