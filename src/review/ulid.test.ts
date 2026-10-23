import { expect, test } from "bun:test";
import { ulid } from "./ulid";

test("is 26 Crockford base32 characters with the time first", () => {
  const id = ulid(Date.UTC(2026, 9, 23));
  expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(id.slice(0, 10)).toBe(ulid(Date.UTC(2026, 9, 23)).slice(0, 10));
  expect(ulid(Date.UTC(2026, 9, 24)) > id).toBe(true);
});

test("increases monotonically within the same millisecond", () => {
  const now = Date.UTC(2027, 0, 1);
  const ids = Array.from({ length: 100 }, () => ulid(now));
  expect([...ids].sort()).toEqual(ids);
  expect(new Set(ids).size).toBe(100);
});
