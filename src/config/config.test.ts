import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigError,
  configToToml,
  DEFAULT_CONFIG,
  initConfig,
  loadConfig,
} from "./config";
import { CONFIG_TEMPLATE } from "./template";

const base = mkdtempSync(join(tmpdir(), "reviewbuddy-config-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
let n = 0;
function home(toml?: string): string {
  const dir = join(base, `h${n++}`);
  mkdirSync(dir);
  if (toml !== undefined) writeFileSync(join(dir, "config.toml"), toml);
  return dir;
}

describe("loadConfig", () => {
  test("uses the defaults without a file", () => {
    expect(loadConfig(home(), {})).toEqual({
      config: DEFAULT_CONFIG,
      warnings: [],
      portExplicit: false,
    });
  });

  test("reads every key", () => {
    const { config, portExplicit } = loadConfig(
      home(`
[server]
host = "0.0.0.0"
port = 5000
open_browser = true
allowed_hosts = ["mymac"]

[viewer]
max_highlight_bytes = 100
exclude = ["*.lock"]

[prompt]
preamble = "Fix these."
max_anchor_lines = 10
resolve_on_copy = true

[retention]
idle_days = 0
ended_days = 3
`),
      {},
    );
    expect(portExplicit).toBe(true);
    expect(config).toEqual({
      server: {
        host: "0.0.0.0",
        port: 5000,
        openBrowser: true,
        allowedHosts: ["mymac"],
      },
      viewer: { maxHighlightBytes: 100, exclude: ["*.lock"] },
      prompt: {
        preamble: "Fix these.",
        maxAnchorLines: 10,
        resolveOnCopy: true,
      },
      retention: { idleDays: 0, endedDays: 3 },
    });
  });

  test("lets environment variables override the file", () => {
    const { config, portExplicit } = loadConfig(
      home('[server]\nhost = "0.0.0.0"\n'),
      { REVIEWBUDDY_HOST: "127.0.0.2", REVIEWBUDDY_PORT: "4500" },
    );
    expect(config.server).toMatchObject({ host: "127.0.0.2", port: 4500 });
    expect(portExplicit).toBe(true);
  });

  test("warns about unknown keys and keeps going", () => {
    const { warnings, config } = loadConfig(
      home('color = "red"\n[server]\nport = 4401\nspeed = 1\n[extra]\nx = 1\n'),
      {},
    );
    expect(warnings).toEqual([
      "Unknown key in config.toml: color",
      "Unknown key in config.toml: server.speed",
      "Unknown key in config.toml: extra",
    ]);
    expect(config.server.port).toBe(4401);
  });

  test.each([
    [
      '[server]\nport = "x"\n',
      "server.port must be an integer from 0 to 65535",
    ],
    [
      "[server]\nport = 70000\n",
      "server.port must be an integer from 0 to 65535",
    ],
    ['[server]\nhost = ""\n', "server.host must be a non-empty string"],
    [
      '[server]\nopen_browser = "yes"\n',
      "server.open_browser must be true or false",
    ],
    ["[viewer]\nexclude = [1]\n", "viewer.exclude must be a list of strings"],
    [
      "[prompt]\nmax_anchor_lines = 2\n",
      "prompt.max_anchor_lines must be an integer of at least 3",
    ],
    [
      "[retention]\nidle_days = -1\n",
      "retention.idle_days must be an integer of at least 0",
    ],
    ['server = "x"\n', "server must be a table"],
    ["[server\n", "config.toml:"],
  ])("rejects %p", (toml, message) => {
    expect(() => loadConfig(home(toml), {})).toThrow(ConfigError);
    expect(() => loadConfig(home(toml), {})).toThrow(message);
  });

  test("rejects invalid environment values", () => {
    expect(() => loadConfig(home(), { REVIEWBUDDY_PORT: "abc" })).toThrow(
      "REVIEWBUDDY_PORT must be an integer from 0 to 65535",
    );
  });
});

describe("config files", () => {
  test("the template parses to the defaults", () => {
    expect(loadConfig(home(CONFIG_TEMPLATE), {})).toEqual({
      config: DEFAULT_CONFIG,
      warnings: [],
      portExplicit: false,
    });
  });

  test("init writes the template once and never overwrites", () => {
    const dir = home();
    expect(initConfig(dir)).toBe(true);
    expect(readFileSync(join(dir, "config.toml"), "utf8")).toBe(
      CONFIG_TEMPLATE,
    );
    writeFileSync(join(dir, "config.toml"), "# mine\n");
    expect(initConfig(dir)).toBe(false);
    expect(readFileSync(join(dir, "config.toml"), "utf8")).toBe("# mine\n");
  });

  test("configToToml round-trips", () => {
    const config = {
      ...DEFAULT_CONFIG,
      prompt: { ...DEFAULT_CONFIG.prompt, preamble: 'Say "hi"\\n' },
    };
    expect(loadConfig(home(configToToml(config)), {}).config).toEqual(config);
  });
});
