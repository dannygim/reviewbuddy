import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "./args";
import { resolveRoot } from "./root";

const base = mkdtempSync(join(tmpdir(), "akapen-root-"));
mkdirSync(join(base, "project"));
writeFileSync(join(base, "file.txt"), "x");

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("resolveRoot", () => {
  test("returns the real path of a directory relative to cwd", () => {
    expect(resolveRoot("project", base)).toBe(
      realpathSync(join(base, "project")),
    );
  });

  test("rejects a missing directory", () => {
    expect(() => resolveRoot("missing", base)).toThrow(UsageError);
    expect(() => resolveRoot("missing", base)).toThrow(
      "Directory not found: missing",
    );
  });

  test("rejects a file", () => {
    expect(() => resolveRoot("file.txt", base)).toThrow(
      "Not a directory: file.txt",
    );
  });
});
