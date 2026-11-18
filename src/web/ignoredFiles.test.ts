import { expect, test } from "bun:test";
import { parseIgnoredFiles } from "./ignoredFiles";

test("only a stored shown shows ignored files", () => {
  expect(parseIgnoredFiles("shown")).toBe(true);
  expect(parseIgnoredFiles("hidden")).toBe(false);
});

test("hides them for anything else", () => {
  for (const value of [null, "", "Shown", "true"]) {
    expect(parseIgnoredFiles(value)).toBe(false);
  }
});
