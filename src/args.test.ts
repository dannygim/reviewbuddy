import { describe, expect, test } from "bun:test";
import { parseCliArgs, UsageError } from "./args";

describe("parseCliArgs serve", () => {
  test("leaves unset options to the config and defaults", () => {
    expect(parseCliArgs([])).toEqual({
      kind: "serve",
      dir: ".",
      watch: true,
      fresh: false,
    });
  });

  test("takes a directory and every option", () => {
    expect(
      parseCliArgs([
        "docs",
        "-p",
        "5000",
        "--host",
        "0.0.0.0",
        "--open",
        "--no-watch",
        "--new",
      ]),
    ).toEqual({
      kind: "serve",
      dir: "docs",
      host: "0.0.0.0",
      port: 5000,
      open: true,
      watch: false,
      fresh: true,
    });
    expect(parseCliArgs(["--no-open"])).toMatchObject({ open: false });
    expect(parseCliArgs(["--session", "s1"])).toMatchObject({
      sessionId: "s1",
    });
  });

  test.each([["--version"], ["-v"]])("%s prints the version", (flag) => {
    expect(parseCliArgs([flag])).toEqual({ kind: "version" });
  });

  test.each([["--help"], ["-h"]])("%s prints the help", (flag) => {
    expect(parseCliArgs([flag])).toEqual({ kind: "help" });
  });

  test("a directory named like a subcommand can be opened as a path", () => {
    expect(parseCliArgs(["./export"])).toMatchObject({
      kind: "serve",
      dir: "./export",
    });
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
    [["--open", "--no-open"], "--open cannot be combined with --no-open"],
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
});

describe("parseCliArgs session and config", () => {
  test.each([
    [["session", "ls"], { action: "ls", all: false }],
    [["session", "ls", "--all"], { action: "ls", all: true }],
    [["session", "end"], { action: "end", target: "." }],
    [["session", "end", "s1"], { action: "end", target: "s1" }],
    [["session", "reopen", "s1"], { action: "reopen", id: "s1" }],
    [["session", "rm", "s1", "s2"], { action: "rm", ids: ["s1", "s2"] }],
    [["session", "prune", "--dry-run"], { action: "prune", dryRun: true }],
  ])("%p", (argv, expected) => {
    expect(parseCliArgs(argv)).toEqual({
      kind: "session",
      ...expected,
    } as never);
  });

  test.each([["init"], ["path"], ["show"]])("config %s", (action) => {
    expect(parseCliArgs(["config", action])).toEqual({
      kind: "config",
      action,
    } as never);
  });

  test.each([
    [["session"], "Invalid session command"],
    [["session", "kill"], "Invalid session command: kill"],
    [["session", "reopen"], "Expected one session id"],
    [["session", "rm"], "Expected at least one session id"],
    [["config", "edit"], "Invalid config command: edit"],
    [["config"], "Expected: reviewbuddy config init | path | show"],
  ])("rejects %p", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(message);
  });
});
