import { expect, test } from "bun:test";
import { diffSequences, type Edit } from "./myers";

const chars = (s: string) => [...s];

/** Rebuilds both sides from the edits, to check they describe a and b. */
function apply(a: string[], b: string[], edits: Edit[]) {
  const left: string[] = [];
  const right: string[] = [];
  for (const e of edits) {
    if (e.type !== "insert") left.push(...a.slice(e.a, e.a + e.count));
    if (e.type !== "delete") right.push(...b.slice(e.b, e.b + e.count));
    if (e.type === "equal")
      expect(a.slice(e.a, e.a + e.count)).toEqual(b.slice(e.b, e.b + e.count));
  }
  return { left, right };
}

const cost = (edits: Edit[]) =>
  edits.filter((e) => e.type !== "equal").reduce((n, e) => n + e.count, 0);

test("returns nothing for two empty sequences", () => {
  expect(diffSequences([], [])).toEqual([]);
});

test("returns one equal run for the same sequence", () => {
  expect(diffSequences(chars("abc"), chars("abc"))).toEqual([
    { type: "equal", a: 0, b: 0, count: 3 },
  ]);
});

test("returns only inserts or only deletes against an empty side", () => {
  expect(diffSequences([], chars("ab"))).toEqual([
    { type: "insert", a: 0, b: 0, count: 2 },
  ]);
  expect(diffSequences(chars("ab"), [])).toEqual([
    { type: "delete", a: 0, b: 0, count: 2 },
  ]);
});

test("finds an insertion in the middle", () => {
  expect(diffSequences(chars("ac"), chars("abc"))).toEqual([
    { type: "equal", a: 0, b: 0, count: 1 },
    { type: "insert", a: 1, b: 1, count: 1 },
    { type: "equal", a: 1, b: 2, count: 1 },
  ]);
});

test("puts a deletion before the insertion that replaces it", () => {
  expect(diffSequences(chars("axc"), chars("ayc"))).toEqual([
    { type: "equal", a: 0, b: 0, count: 1 },
    { type: "delete", a: 1, b: 1, count: 1 },
    { type: "insert", a: 2, b: 1, count: 1 },
    { type: "equal", a: 2, b: 2, count: 1 },
  ]);
});

test("finds a shortest edit script", () => {
  const a = chars("ABCABBA");
  const b = chars("CBABAC");
  const edits = diffSequences(a, b);
  expect(apply(a, b, edits)).toEqual({ left: a, right: b });
  expect(cost(edits)).toBe(5);
});

test("replaces everything when the edit cost goes over the limit", () => {
  const a = chars("abcdef");
  const b = chars("uvwxyz");
  expect(diffSequences(a, b, 4)).toEqual([
    { type: "delete", a: 0, b: 0, count: 6 },
    { type: "insert", a: 6, b: 0, count: 6 },
  ]);
});

test("keeps a common prefix and suffix even over the limit", () => {
  const a = chars("<abcdef>");
  const b = chars("<uvwxyz>");
  expect(diffSequences(a, b, 4)).toEqual([
    { type: "equal", a: 0, b: 0, count: 1 },
    { type: "delete", a: 1, b: 1, count: 6 },
    { type: "insert", a: 7, b: 1, count: 6 },
    { type: "equal", a: 7, b: 7, count: 1 },
  ]);
});
