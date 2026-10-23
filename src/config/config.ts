import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensurePrivateDir, writePrivateFile } from "../session/home";
import { CONFIG_TEMPLATE } from "./template";

export type Config = {
  server: {
    host: string;
    port: number;
    openBrowser: boolean;
    allowedHosts: string[];
  };
  viewer: { maxHighlightBytes: number; exclude: string[] };
  prompt: { preamble: string; maxAnchorLines: number; resolveOnCopy: boolean };
  retention: { idleDays: number; endedDays: number };
};

export const DEFAULT_CONFIG: Config = {
  server: {
    host: "127.0.0.1",
    port: 4400,
    openBrowser: false,
    allowedHosts: [],
  },
  viewer: { maxHighlightBytes: 2_000_000, exclude: [] },
  prompt: { preamble: "", maxAnchorLines: 30, resolveOnCopy: false },
  retention: { idleDays: 60, endedDays: 14 },
};

/** An invalid config.toml or environment value; akapen does not start. */
export class ConfigError extends Error {}

type Kind = { check: (value: unknown) => boolean; describe: string };

const integer = (min: number, max?: number): Kind => ({
  check: (v) =>
    Number.isInteger(v) &&
    (v as number) >= min &&
    (max === undefined || (v as number) <= max),
  describe:
    max === undefined
      ? `an integer of at least ${min}`
      : `an integer from ${min} to ${max}`,
});
const boolean: Kind = {
  check: (v) => typeof v === "boolean",
  describe: "true or false",
};
const string = (nonEmpty: boolean): Kind => ({
  check: (v) => typeof v === "string" && (!nonEmpty || v.length > 0),
  describe: nonEmpty ? "a non-empty string" : "a string",
});
const strings: Kind = {
  check: (v) => Array.isArray(v) && v.every((x) => typeof x === "string"),
  describe: "a list of strings",
};
const PORT = integer(0, 65535);

// TOML key → [Config field, kind], per section (docs/design/設定ファイル.md).
const SCHEMA: Record<keyof Config, Record<string, [string, Kind]>> = {
  server: {
    host: ["host", string(true)],
    port: ["port", PORT],
    open_browser: ["openBrowser", boolean],
    allowed_hosts: ["allowedHosts", strings],
  },
  viewer: {
    max_highlight_bytes: ["maxHighlightBytes", integer(1)],
    exclude: ["exclude", strings],
  },
  prompt: {
    preamble: ["preamble", string(false)],
    max_anchor_lines: ["maxAnchorLines", integer(3)],
    resolve_on_copy: ["resolveOnCopy", boolean],
  },
  retention: {
    idle_days: ["idleDays", integer(0)],
    ended_days: ["endedDays", integer(0)],
  },
};

export function configPath(home: string): string {
  return join(home, "config.toml");
}

export function loadConfig(
  home: string,
  env: Record<string, string | undefined> = process.env,
): { config: Config; warnings: string[]; portExplicit: boolean } {
  const config = structuredClone(DEFAULT_CONFIG);
  const warnings: string[] = [];
  let portExplicit = false;

  const path = configPath(home);
  if (existsSync(path)) {
    let data: Record<string, unknown>;
    try {
      data = Bun.TOML.parse(readFileSync(path, "utf8")) as Record<
        string,
        unknown
      >;
    } catch (error) {
      throw new ConfigError(`config.toml: ${(error as Error).message}`);
    }
    for (const [section, table] of Object.entries(data)) {
      const schema = SCHEMA[section as keyof Config];
      if (!schema) {
        warnings.push(`Unknown key in config.toml: ${section}`);
        continue;
      }
      if (typeof table !== "object" || table === null || Array.isArray(table)) {
        throw new ConfigError(`config.toml: ${section} must be a table`);
      }
      for (const [key, value] of Object.entries(table)) {
        const entry = schema[key];
        if (!entry) {
          warnings.push(`Unknown key in config.toml: ${section}.${key}`);
          continue;
        }
        const [field, kind] = entry;
        if (!kind.check(value)) {
          throw new ConfigError(
            `config.toml: ${section}.${key} must be ${kind.describe}`,
          );
        }
        (config[section as keyof Config] as Record<string, unknown>)[field] =
          value;
        if (section === "server" && key === "port") portExplicit = true;
      }
    }
  }

  if (env.AKAPEN_HOST) config.server.host = env.AKAPEN_HOST;
  if (env.AKAPEN_PORT) {
    const port = Number(env.AKAPEN_PORT);
    if (!PORT.check(port)) {
      throw new ConfigError(`AKAPEN_PORT must be ${PORT.describe}`);
    }
    config.server.port = port;
    portExplicit = true;
  }
  return { config, warnings, portExplicit };
}

/** Writes the commented template unless a config file exists. */
export function initConfig(home: string): boolean {
  ensurePrivateDir(home);
  if (existsSync(configPath(home))) return false;
  writePrivateFile(configPath(home), CONFIG_TEMPLATE);
  return true;
}

const tomlValue = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(tomlValue).join(", ")}]`
    : typeof value === "string"
      ? JSON.stringify(value) // JSON escapes are valid TOML basic-string escapes
      : String(value);

/** The effective configuration as TOML (`akapen config show`). */
export function configToToml(config: Config): string {
  return Object.entries(SCHEMA)
    .map(([section, fields]) => {
      const values = config[section as keyof Config] as Record<string, unknown>;
      const lines = Object.entries(fields).map(
        ([key, [field]]) => `${key} = ${tomlValue(values[field])}`,
      );
      return `[${section}]\n${lines.join("\n")}\n`;
    })
    .join("\n");
}
