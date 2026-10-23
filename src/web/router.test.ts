import { expect, test } from "bun:test";
import { docPathFromHash, hashForDocPath } from "./router";

test.each([
  ["doc/A.md", "#/doc/doc/A.md"],
  ["a b/#1?.md", "#/doc/a%20b/%231%3F.md"],
  ["日本語.md", "#/doc/%E6%97%A5%E6%9C%AC%E8%AA%9E.md"],
])("round-trips %p", (path, hash) => {
  expect(hashForDocPath(path)).toBe(hash);
  expect(docPathFromHash(hash)).toBe(path);
});

test.each([[""], ["#"], ["#/doc/"], ["#/other/a.md"], ["#/doc/%E0%A4%A"]])(
  "ignores %p",
  (hash) => {
    expect(docPathFromHash(hash)).toBeNull();
  },
);
