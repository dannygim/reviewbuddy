import { expect, test } from "bun:test";
import { wordRanges } from "./words";

test("marks the words that differ on both lines", () => {
  expect(
    wordRanges(
      "IsRequest:   row.IsRequest,",
      "OrderPattern: row.OrderPattern,",
    ),
  ).toEqual({
    old: [
      [0, 9],
      [10, 13],
      [17, 26],
    ],
    new: [
      [0, 12],
      [13, 14],
      [18, 30],
    ],
  });
});

test("marks a change in whitespace only", () => {
  expect(wordRanges("a  b", "a b")).toEqual({ old: [[1, 3]], new: [[1, 2]] });
});

test("marks added words on one side only", () => {
  expect(wordRanges("f(a)", "f(a, b)")).toEqual({ old: [], new: [[3, 6]] });
});

test("compares Japanese text character by character", () => {
  expect(wordRanges("店舗を同期する", "商品を同期する")).toEqual({
    old: [[0, 2]],
    new: [[0, 2]],
  });
});

test("marks nothing when the lines share no word", () => {
  expect(wordRanges("foo", "bar")).toBeNull();
  expect(wordRanges("foo bar", "baz qux")).toBeNull();
});
