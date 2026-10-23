import { expect, test } from "bun:test";
import { anchorFor } from "./anchor";

const text = "one\ntwo\nthree\n";

test("cuts the selected source lines", () => {
  expect(anchorFor(text, 2, 3)?.anchorText).toBe("two\nthree");
  expect(anchorFor(text, 1, 1)?.anchorText).toBe("one");
});

test("hashes the whole file", () => {
  expect(anchorFor(text, 1, 1)?.fileSha).toBe(
    new Bun.CryptoHasher("sha256").update(text).digest("hex"),
  );
});

test.each([
  [0, 1],
  [2, 1],
  [3, 4],
  [1.5, 2],
])("rejects lines %p-%p", (start, end) => {
  expect(anchorFor(text, start, end)).toBeNull();
});
