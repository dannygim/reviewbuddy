import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  reviewbuddyHome,
  ensurePrivateDir,
  ensureSessionsDir,
  writePrivateFile,
} from "./home";

const base = mkdtempSync(join(tmpdir(), "reviewbuddy-home-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const mode = (path: string) => statSync(path).mode & 0o777;

describe("reviewbuddyHome", () => {
  test("prefers REVIEWBUDDY_HOME", () => {
    expect(
      reviewbuddyHome({ REVIEWBUDDY_HOME: "/a", XDG_CONFIG_HOME: "/x" }),
    ).toBe("/a");
  });

  test("falls back to XDG_CONFIG_HOME, then ~/.config", () => {
    expect(reviewbuddyHome({ XDG_CONFIG_HOME: "/x" })).toBe("/x/reviewbuddy");
    expect(reviewbuddyHome({})).toBe(join(homedir(), ".config", "reviewbuddy"));
    expect(reviewbuddyHome({ REVIEWBUDDY_HOME: "", XDG_CONFIG_HOME: "" })).toBe(
      join(homedir(), ".config", "reviewbuddy"),
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
