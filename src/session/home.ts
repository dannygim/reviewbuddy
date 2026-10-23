import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where config.toml and sessions live: $REVIEWBUDDY_HOME, else $XDG_CONFIG_HOME/reviewbuddy, else ~/.config/reviewbuddy. */
export function reviewbuddyHome(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.REVIEWBUDDY_HOME) return env.REVIEWBUDDY_HOME;
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "reviewbuddy");
}

// Comments may contain secrets, so everything reviewbuddy writes is private to the user.
export function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

/** Writes through a temporary file and rename, so readers never see a partial file. */
export function writePrivateFile(path: string, content: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content, { mode: 0o600 });
  renameSync(temp, path);
}

export function ensureSessionsDir(home: string): string {
  ensurePrivateDir(home);
  const sessions = join(home, "sessions");
  ensurePrivateDir(sessions);
  // Keeps comments out of Git for people who version ~/.config as dotfiles.
  const gitignore = join(sessions, ".gitignore");
  if (!existsSync(gitignore)) writePrivateFile(gitignore, "*\n");
  return sessions;
}
