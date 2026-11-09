import { expect, test } from "bun:test";
import type { ChangedFile } from "../shared/api";
import { markViewed, parseViewed, viewedKey, viewedPaths } from "./viewed";

const file = (path: string, version: string): ChangedFile => ({
  path,
  oldPath: null,
  status: "modified",
  additions: 1,
  deletions: 1,
  version,
});

test("reads stored marks and ignores anything malformed", () => {
  expect(parseViewed('{"a.ts":"v1","b.ts":"v2"}')).toEqual({
    "a.ts": "v1",
    "b.ts": "v2",
  });
  expect(parseViewed('{"a.ts":"v1","b.ts":2}')).toEqual({ "a.ts": "v1" });
  for (const value of [null, "", "{", "[]", '"a"', "null"]) {
    expect(parseViewed(value)).toEqual({});
  }
});

test("counts a file as viewed only while its change is the one viewed", () => {
  const marks = { "a.ts": "v1", "b.ts": "old", "gone.ts": "v1" };
  const files = [file("a.ts", "v1"), file("b.ts", "new"), file("c.ts", "v1")];
  expect(viewedPaths(marks, files)).toEqual(new Set(["a.ts"]));
});

test("marks and unmarks a file, dropping files no longer changed", () => {
  const files = [file("a.ts", "v1"), file("b.ts", "v2")];
  const marks = { "a.ts": "v1", "gone.ts": "v9" };
  expect(markViewed(marks, files, "b.ts", true)).toEqual({
    "a.ts": "v1",
    "b.ts": "v2",
  });
  expect(markViewed(marks, files, "a.ts", false)).toEqual({});
});

test("keeps the marks of each branch compared with apart", () => {
  expect(viewedKey("s1", null)).toBe("reviewbuddy.viewed.s1");
  expect(viewedKey("s1", "origin/main")).toBe(
    "reviewbuddy.viewed.s1.origin/main",
  );
});
