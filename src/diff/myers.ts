/** A run of elements: equal on both sides, deleted from a, or inserted from b. */
export type Edit = {
  type: "equal" | "delete" | "insert";
  /** Where the run starts in a (for an insert: the position it goes before). */
  a: number;
  /** Where the run starts in b (for a delete: the position it goes before). */
  b: number;
  count: number;
};

type Op = "equal" | "delete" | "insert";

/**
 * A shortest edit script from a to b (Myers' O(ND) algorithm), as runs. Each
 * changed stretch is one delete run followed by one insert run. When more than
 * `maxCost` elements would have to change, the stretch between the common
 * prefix and suffix is replaced as a whole instead.
 */
export function diffSequences<T>(
  a: readonly T[],
  b: readonly T[],
  maxCost = Infinity,
): Edit[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middle = shortestPath(
    a.slice(start, endA),
    b.slice(start, endB),
    maxCost,
  ) ?? [
    ...Array<Op>(endA - start).fill("delete"),
    ...Array<Op>(endB - start).fill("insert"),
  ];
  const ops: Op[] = [
    ...Array<Op>(start).fill("equal"),
    ...middle,
    ...Array<Op>(a.length - endA).fill("equal"),
  ];
  return toRuns(ops);
}

function shortestPath<T>(a: T[], b: T[], maxCost: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) {
    return [...Array<Op>(n).fill("delete"), ...Array<Op>(m).fill("insert")];
  }
  // Sized for the costs searched, not the input: memory grows with maxCost².
  const max = Math.min(n + m, maxCost);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] keeps only diagonals -d-1..d+1, the ones step d reads.
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], n: number, m: number): Op[] {
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]!;
    const at = (k: number) => v[k + d + 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = d === 0 ? 0 : down ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push("equal");
      x--;
      y--;
    }
    if (d > 0) {
      ops.push(down ? "insert" : "delete");
      x = prevX;
      y = prevY;
    }
  }
  return ops.reverse();
}

/** Groups single-element operations into runs, deletes before inserts. */
function toRuns(ops: Op[]): Edit[] {
  const runs: Edit[] = [];
  let a = 0;
  let b = 0;
  let i = 0;
  while (i < ops.length) {
    if (ops[i] === "equal") {
      let count = 0;
      while (ops[i] === "equal") {
        count++;
        i++;
      }
      runs.push({ type: "equal", a, b, count });
      a += count;
      b += count;
      continue;
    }
    let deleted = 0;
    let inserted = 0;
    while (i < ops.length && ops[i] !== "equal") {
      if (ops[i] === "delete") deleted++;
      else inserted++;
      i++;
    }
    if (deleted) runs.push({ type: "delete", a, b, count: deleted });
    if (inserted)
      runs.push({ type: "insert", a: a + deleted, b, count: inserted });
    a += deleted;
    b += inserted;
  }
  return runs;
}
