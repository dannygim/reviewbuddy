import { describe, expect, test } from "bun:test";
import { reanchor } from "./reanchor";

const thread = { startLine: 3, endLine: 4, anchorText: "c\nd" };
const file = (s: string) => s.split("");

describe("reanchor", () => {
  test("keeps a thread whose lines are unchanged", () => {
    expect(reanchor(thread, file("abcdef"))).toEqual({
      startLine: 3,
      endLine: 4,
      outdated: false,
    });
  });

  test("follows lines inserted above", () => {
    expect(reanchor(thread, file("xxabcdef"))).toEqual({
      startLine: 5,
      endLine: 6,
      outdated: false,
    });
  });

  test("follows lines deleted above", () => {
    expect(reanchor(thread, file("bcdef"))).toEqual({
      startLine: 2,
      endLine: 3,
      outdated: false,
    });
  });

  test("is outdated when a selected line was edited", () => {
    expect(reanchor(thread, file("abCdef"))).toEqual({
      startLine: 3,
      endLine: 4,
      outdated: true,
    });
  });

  test("is outdated when a selected line was deleted", () => {
    expect(reanchor(thread, file("abdef"))).toEqual({
      startLine: 3,
      endLine: 4,
      outdated: true,
    });
  });

  test("is outdated when the file is gone", () => {
    expect(reanchor(thread, null)).toEqual({
      startLine: 3,
      endLine: 4,
      outdated: true,
    });
  });

  test("picks the nearest copy, the earlier one on a tie", () => {
    // copies at 2-3 and 7-8; the old position 3 is nearer to 2
    expect(reanchor(thread, file("acdxxxcdx"))).toEqual({
      startLine: 2,
      endLine: 3,
      outdated: false,
    });
    // copies at 1-2 and 5-6 are equally far from 3
    expect(reanchor(thread, file("cdxxcd"))).toEqual({
      startLine: 1,
      endLine: 2,
      outdated: false,
    });
  });

  test("recovers once the lines come back", () => {
    const outdated = reanchor(thread, file("abXYef"));
    expect(outdated.outdated).toBe(true);
    expect(reanchor({ ...thread, ...outdated }, file("abcdef"))).toEqual({
      startLine: 3,
      endLine: 4,
      outdated: false,
    });
  });
});
