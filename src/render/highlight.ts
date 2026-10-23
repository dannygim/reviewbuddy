import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { escapeHtml } from "./html";

// Static import paths so the bundler embeds only these grammars (Shiki's
// bundledLanguagesInfo would pull every language into the binary).
export const LANGUAGE_MODULES = {
  docker: () => import("shiki/langs/docker.mjs"),
  make: () => import("shiki/langs/make.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  dotenv: () => import("shiki/langs/dotenv.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  dart: () => import("shiki/langs/dart.mjs"),
  elixir: () => import("shiki/langs/elixir.mjs"),
  hcl: () => import("shiki/langs/hcl.mjs"),
  proto: () => import("shiki/langs/proto.mjs"),
  nix: () => import("shiki/langs/nix.mjs"),
  zig: () => import("shiki/langs/zig.mjs"),
};

let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [
      import("shiki/themes/github-light.mjs"),
      import("shiki/themes/github-dark.mjs"),
    ],
    langs: Object.values(LANGUAGE_MODULES).map((load) => load()),
    engine: createOnigurumaEngine(import("shiki/wasm")),
  });
  return highlighter;
}

/** Splits text into lines; a final newline does not start an extra line. */
export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

/** Returns one HTML string per line, colored for both light and dark themes. */
export async function highlightLines(
  lines: string[],
  lang: string,
): Promise<string[]> {
  if (lang === "text") return lines.map(escapeHtml);
  const hl = await getHighlighter();
  const { tokens } = hl.codeToTokens(lines.join("\n"), {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
  });
  return lines.map((_, i) =>
    (tokens[i] ?? [])
      .map((token) => {
        const style = Object.entries(token.htmlStyle ?? {})
          .map(([key, value]) => `${key}:${value}`)
          .join(";");
        return `<span style="${escapeHtml(style)}">${escapeHtml(token.content)}</span>`;
      })
      .join(""),
  );
}
