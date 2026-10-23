import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { bundledLanguagesInfo } from "shiki/langs";
import { escapeHtml } from "./html";
import { LANGUAGES } from "./language";

let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [
      import("shiki/themes/github-light.mjs"),
      import("shiki/themes/github-dark.mjs"),
    ],
    langs: bundledLanguagesInfo
      .filter((info) => LANGUAGES.includes(info.id))
      .map((info) => info.import),
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
