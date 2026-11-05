import { expect, test } from "bun:test";
import type { DiffChange } from "../shared/api";
import { type DiffRow, diffRows } from "./diffRows";

const change = (
  oldStart: number,
  oldCount: number,
  newStart: number,
  newCount: number,
  context = "",
): DiffChange => ({ oldStart, oldCount, newStart, newCount, context });

/** Compact rows: "@<header>|<hidden>", " o/n", "-o", "+n". */
const show = (rows: DiffRow[]) =>
  rows.map((r) => {
    switch (r.type) {
      case "hunk":
        return `@${r.header}|${r.hidden}`;
      case "context":
        return ` ${r.old}/${r.new}`;
      case "delete":
        return `-${r.old}`;
      case "insert":
        return `+${r.new}`;
    }
  });

test("shows 3 lines around a change and hides the rest", () => {
  expect(show(diffRows([change(10, 1, 10, 1, "func main()")], 20, 20))).toEqual(
    [
      "@@@ -7,7 +7,7 @@ func main()|6",
      " 7/7",
      " 8/8",
      " 9/9",
      "-10",
      "+10",
      " 11/11",
      " 12/12",
      " 13/13",
      "@|7",
    ],
  );
});

test("joins changes up to 6 lines apart into one hunk", () => {
  const rows = show(diffRows([change(2, 1, 2, 1), change(9, 1, 9, 1)], 9, 9));
  expect(rows.filter((r) => r.startsWith("@"))).toEqual(["@@@ -1,9 +1,9 @@|0"]);
});

test("splits changes further apart into two hunks", () => {
  const rows = show(
    diffRows([change(2, 1, 2, 1), change(11, 1, 11, 1, "b")], 11, 11),
  );
  expect(rows.filter((r) => r.startsWith("@"))).toEqual([
    "@@@ -1,5 +1,5 @@|0",
    "@@@ -8,4 +8,4 @@ b|2",
  ]);
});

test("numbers a pure insertion like git", () => {
  expect(show(diffRows([change(3, 0, 4, 1)], 5, 6))).toEqual([
    "@@@ -1,5 +1,6 @@|0",
    " 1/1",
    " 2/2",
    " 3/3",
    "+4",
    " 4/5",
    " 5/6",
  ]);
});

test("shows added and deleted files whole", () => {
  expect(show(diffRows([change(0, 0, 1, 2)], 0, 2))).toEqual([
    "@@@ -0,0 +1,2 @@|0",
    "+1",
    "+2",
  ]);
  expect(show(diffRows([change(1, 2, 0, 0)], 2, 0))).toEqual([
    "@@@ -1,2 +0,0 @@|0",
    "-1",
    "-2",
  ]);
});

test("reveals hidden lines from either side of a gap", () => {
  const changes = [change(10, 1, 10, 1)];
  const below = show(diffRows(changes, 20, 20, { 1: { top: 2, bottom: 0 } }));
  expect(below.slice(-3)).toEqual([" 14/14", " 15/15", "@|5"]);
  const above = show(diffRows(changes, 20, 20, { 0: { top: 0, bottom: 20 } }));
  expect(above.slice(0, 2)).toEqual(["@@@ -1,13 +1,13 @@|0", " 1/1"]);
});

test("returns no rows without changes", () => {
  expect(diffRows([], 3, 3)).toEqual([]);
});
