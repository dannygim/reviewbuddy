import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  akapenHome,
  ensurePrivateDir,
  ensureSessionsDir,
  writePrivateFile,
} from "./home";

const base = mkdtempSync(join(tmpdir(), "akapen-home-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const mode = (path: string) => statSync(path).mode & 0o777;

describe("akapenHome", () => {
  test("prefers AKAPEN_HOME", () => {
    expect(akapenHome({ AKAPEN_HOME: "/a", XDG_CONFIG_HOME: "/x" })).toBe("/a");
  });

  test("falls back to XDG_CONFIG_HOME, then ~/.config", () => {
    expect(akapenHome({ XDG_CONFIG_HOME: "/x" })).toBe("/x/akapen");
    expect(akapenHome({})).toBe(join(homedir(), ".config", "akapen"));
    expect(akapenHome({ AKAPEN_HOME: "", XDG_CONFIG_HOME: "" })).toBe(
      join(homedir(), ".config", "akapen"),
    );
  });
});

describe("private files", () => {
  test("creates directories readable only by the user", () => {
    const dir = join(base, "a", "b");
    ensurePrivateDir(dir);
    expect(mode(dir)).toBe(0o700);
  });

  test("writes files readable only by the user, replacing atomically", () => {
    const file = join(base, "f.json");
    writePrivateFile(file, "one");
    writePrivateFile(file, "two");
    expect(readFileSync(file, "utf8")).toBe("two");
    expect(mode(file)).toBe(0o600);
  });

  test("sets up the sessions directory with a .gitignore", () => {
    const home = join(base, "home");
    const sessions = ensureSessionsDir(home);
    expect(sessions).toBe(join(home, "sessions"));
    expect(mode(home)).toBe(0o700);
    expect(mode(sessions)).toBe(0o700);
    expect(readFileSync(join(sessions, ".gitignore"), "utf8")).toBe("*\n");
  });
});
