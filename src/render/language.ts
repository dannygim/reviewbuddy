const BY_NAME: Record<string, string> = {
  Dockerfile: "docker",
  Containerfile: "docker",
  Makefile: "make",
  GNUmakefile: "make",
  makefile: "make",
  Gemfile: "ruby",
  Rakefile: "ruby",
  ".env": "dotenv",
  ".bashrc": "shellscript",
  ".zshrc": "shellscript",
};

const BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  rb: "ruby",
  php: "php",
  sql: "sql",
  diff: "diff",
  patch: "diff",
  xml: "xml",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  lua: "lua",
  ini: "ini",
  cfg: "ini",
  graphql: "graphql",
  gql: "graphql",
  vue: "vue",
  svelte: "svelte",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  hcl: "hcl",
  tf: "hcl",
  proto: "proto",
  nix: "nix",
  zig: "zig",
};

/** Languages loaded into the highlighter (kept small to limit binary size). */
export const LANGUAGES = [
  ...new Set([...Object.values(BY_NAME), ...Object.values(BY_EXTENSION)]),
];

export function detectLanguage(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const byName =
    BY_NAME[name] ?? (name.startsWith(".env.") ? "dotenv" : undefined);
  if (byName) return byName;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "text";
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? "text";
}
