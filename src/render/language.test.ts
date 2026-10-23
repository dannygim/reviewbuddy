import { expect, test } from "bun:test";
import { detectLanguage } from "./language";

test.each([
  ["Dockerfile", "docker"],
  ["deploy/Dockerfile", "docker"],
  ["Makefile", "make"],
  ["mise.toml", "toml"],
  [".env", "dotenv"],
  ["config/.env.local", "dotenv"],
  ["src/a.ts", "typescript"],
  ["src/App.tsx", "tsx"],
  ["README.md", "markdown"],
  ["script.SH", "shellscript"],
  ["x.unknown", "text"],
  ["LICENSE", "text"],
])("%s is %s", (path, lang) => {
  expect(detectLanguage(path)).toBe(lang);
});

test("every detected language has a grammar to load", async () => {
  const { LANGUAGE_MODULES } = await import("./highlight");
  const { LANGUAGES } = await import("./language");
  expect(LANGUAGES.filter((id) => !(id in LANGUAGE_MODULES))).toEqual([]);
});
