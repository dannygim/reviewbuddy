import { expect, test } from "bun:test";
import { stackTops } from "./stack";

const boxes = (...list: [number, number][]) =>
  list.map(([wanted, height]) => ({ wanted, height }));

test("returns nothing for no boxes", () => {
  expect(stackTops([], 8)).toEqual([]);
});

test("keeps boxes that do not overlap where they want to be", () => {
  expect(stackTops(boxes([0, 50], [100, 50]), 8)).toEqual([0, 100]);
});

test("pushes an overlapping box below the one before", () => {
  expect(stackTops(boxes([0, 50], [20, 50]), 8)).toEqual([0, 58]);
});

test("keeps pushing down a run of overlapping boxes", () => {
  expect(stackTops(boxes([0, 50], [10, 50], [20, 50]), 8)).toEqual([
    0, 58, 116,
  ]);
});

test("leaves a box far enough below a pushed one where it wants to be", () => {
  expect(stackTops(boxes([0, 50], [10, 50], [500, 50]), 8)).toEqual([
    0, 58, 500,
  ]);
});

test("keeps a pinned box where it wants to be and pushes the ones before it up", () => {
  expect(stackTops(boxes([0, 100], [10, 100], [20, 100]), 8, 2)).toEqual([
    -196, -88, 20,
  ]);
});

test("pushes the boxes after a pinned box down as usual", () => {
  expect(stackTops(boxes([0, 50], [10, 50], [20, 50]), 8, 1)).toEqual([
    -48, 10, 68,
  ]);
});

test("does not move the boxes before a pinned box when there is room", () => {
  expect(stackTops(boxes([0, 50], [0, 50], [500, 50]), 8, 2)).toEqual([
    0, 58, 500,
  ]);
});
