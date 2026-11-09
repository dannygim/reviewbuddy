import { expect, test } from "bun:test";
import { changesBase, changesHash } from "./router";

test.each([
  [null, "#/changes"],
  ["main", "#/changes?base=main"],
  ["origin/feature/x", "#/changes?base=origin%2Ffeature%2Fx"],
])("round-trips the branch %p", (base, hash) => {
  expect(changesHash(base)).toBe(hash);
  expect(changesBase(hash)).toBe(base);
});

test("reads no branch from an empty base, and no Changes view from other hashes", () => {
  expect(changesBase("#/changes?base=")).toBeNull();
  expect(changesBase("#/changes?other=1")).toBeNull();
  for (const hash of ["", "#/doc/a.md", "#/changesx", "#/changes/x"]) {
    expect(changesBase(hash)).toBeUndefined();
  }
});
