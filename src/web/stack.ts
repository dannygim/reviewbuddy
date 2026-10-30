/**
 * Tops for boxes that want to start at `wanted`, in the given order, each
 * at least `gap` below the bottom of the one before. The `pinned` box (an
 * index) stays where it wants to be and pushes the boxes before it up.
 */
export function stackTops(
  boxes: { wanted: number; height: number }[],
  gap: number,
  pinned = -1,
): number[] {
  const tops: number[] = [];
  let bottom = -Infinity;
  for (const [i, box] of boxes.entries()) {
    const top = i === pinned ? box.wanted : Math.max(box.wanted, bottom + gap);
    tops.push(top);
    bottom = top + box.height;
  }
  for (let i = pinned - 1; i >= 0; i--) {
    tops[i] = Math.min(tops[i]!, tops[i + 1]! - gap - boxes[i]!.height);
  }
  return tops;
}
