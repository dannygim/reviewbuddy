import { expect, test } from "bun:test";
import { parsePaneOpen } from "./panes";

test("only a stored closed closes the pane", () => {
  expect(parsePaneOpen("open")).toBe(true);
  expect(parsePaneOpen("closed")).toBe(false);
});

test("opens the pane for anything else", () => {
  for (const value of [null, "", "Closed", "false"]) {
    expect(parsePaneOpen(value)).toBe(true);
  }
});
