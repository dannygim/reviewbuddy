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
      fresh: false,
    });
  });

  test("takes a directory, port and host; an explicit port is strict", () => {
    expect(parseCliArgs(["docs", "-p", "5000", "--host", "0.0.0.0"])).toEqual({
      kind: "serve",
      dir: "docs",
      host: "0.0.0.0",
      port: 5000,
      strictPort: true,
      fresh: false,
    });
  });

  test("--new starts a fresh session", () => {
    expect(parseCliArgs(["--new"])).toMatchObject({
      kind: "serve",
      fresh: true,
    });
  });

  test("--session opens a session by id", () => {
    expect(parseCliArgs(["--session", "20261023-1530-p-3f9a"])).toMatchObject({
      kind: "serve",
      sessionId: "20261023-1530-p-3f9a",
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
    [
      ["--session", "x", "dir"],
      "--session cannot be combined with a directory",
    ],
    [["--session", "x", "--new"], "--session cannot be combined with --new"],
  ])("rejects %p", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(UsageError);
    expect(() => parseCliArgs(argv)).toThrow(message);
  });
});

describe("parseCliArgs export", () => {
  test("defaults to open threads as a prompt for the current directory", () => {
    expect(parseCliArgs(["export"])).toEqual({
      kind: "export",
      dir: ".",
      status: "open",
      format: "prompt",
    });
  });

  test("takes a directory or a session, a status and a format", () => {
    expect(
      parseCliArgs(["export", "proj", "--status", "all", "--format", "jsonl"]),
    ).toEqual({
      kind: "export",
      dir: "proj",
      status: "all",
      format: "jsonl",
    });
    expect(parseCliArgs(["export", "--session", "s1"])).toMatchObject({
      kind: "export",
      sessionId: "s1",
    });
  });

  test.each([
    [["export", "--status", "done"], "Invalid --status: done"],
    [["export", "--format", "xml"], "Invalid --format: xml"],
    [
      ["export", "--session", "s1", "dir"],
      "--session cannot be combined with a directory",
    ],
  ])("rejects %p", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(message);
  });

  test("a directory named export can be opened as ./export", () => {
    expect(parseCliArgs(["./export"])).toMatchObject({
      kind: "serve",
      dir: "./export",
    });
  });
});
