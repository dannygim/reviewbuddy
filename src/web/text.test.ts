import { expect, test } from "bun:test";
import { relativeTime } from "./text";

const now = Date.parse("2026-10-23T06:00:00Z");

test.each([
  ["2026-10-23T05:59:30Z", "just now"],
  ["2026-10-23T05:58:00Z", "2 minutes ago"],
  ["2026-10-23T03:00:00Z", "3 hours ago"],
  ["2026-10-22T06:00:00Z", "yesterday"],
])("%s is %p", (iso, text) => {
  expect(relativeTime(iso, now)).toBe(text);
});
