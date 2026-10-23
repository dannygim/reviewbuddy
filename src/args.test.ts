import { describe, expect, test } from "bun:test";
import { DEFAULT_HOST, DEFAULT_PORT, parseCliArgs, UsageError } from "./args";

describe("parseCliArgs", () => {
  test("defaults to the current directory on 127.0.0.1:4400", () => {
    expect(parseCliArgs([])).toEqual({
      kind: "serve",
      dir: ".",
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      strictPort: false,
    });
  });

  test("takes a directory, port and host; an explicit port is strict", () => {
    expect(parseCliArgs(["docs", "-p", "5000", "--host", "0.0.0.0"])).toEqual({
      kind: "serve",
      dir: "docs",
      host: "0.0.0.0",
      port: 5000,
      strictPort: true,
    });
  });

  test.each([["--version"], ["-v"]])("%s prints the version", (flag) => {
    expect(parseCliArgs([flag])).toEqual({ kind: "version" });
  });

  test.each([["--help"], ["-h"]])("%s prints the help", (flag) => {
    expect(parseCliArgs([flag])).toEqual({ kind: "help" });
  });

  test.each([
    [["--port", "abc"], "Invalid port: abc"],
    [["--port", "70000"], "Invalid port: 70000"],
    [["--nope"], "Unknown option"],
    [["a", "b"], "Expected at most one directory"],
  ])("rejects %p", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(UsageError);
    expect(() => parseCliArgs(argv)).toThrow(message);
  });
});
