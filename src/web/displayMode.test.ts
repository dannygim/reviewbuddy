import { expect, test } from "bun:test";
import { parseDisplayMode } from "./displayMode";

test("keeps the three valid modes", () => {
  expect(parseDisplayMode("light")).toBe("light");
  expect(parseDisplayMode("dark")).toBe("dark");
  expect(parseDisplayMode("system")).toBe("system");
});

test("falls back to system for anything else", () => {
  for (const value of [null, "", "Dark", "auto"]) {
    expect(parseDisplayMode(value)).toBe("system");
  }
});
