/** Written by `akapen config init`; every value shown is the default. */
export const CONFIG_TEMPLATE = `# akapen configuration. Every key is optional; the values below are the defaults.
# Precedence: command-line flags > environment variables (AKAPEN_PORT, AKAPEN_HOST) > this file.

[server]
# Address to bind. "0.0.0.0" lets other devices on your tailnet connect directly.
host = "127.0.0.1"
# A port set here (or in AKAPEN_PORT or --port) is fixed: akapen will not move to
# the next free port, so a proxy such as \`tailscale serve 4400\` keeps working.
# port = 4400
# Open the browser when akapen starts (--open / --no-open).
open_browser = false
# Host names to accept besides IP addresses, localhost and *.ts.net,
# e.g. a MagicDNS short name: ["mymac"].
allowed_hosts = []

[viewer]
# Files larger than this are shown without syntax highlighting.
max_highlight_bytes = 2000000
# Patterns to hide in addition to .gitignore (gitignore syntax),
# e.g. ["*.lock", "pnpm-lock.yaml"].
exclude = []

[prompt]
# Text placed before the threads in a copied prompt.
preamble = ""
# Longer selections keep their first and last lines around an omission marker.
max_anchor_lines = 30
# Resolve threads when they are copied as a prompt (the default of the checkbox).
resolve_on_copy = false

[retention]
# Days without activity before an active session is ended (0 = never).
idle_days = 60
# Days after a session ended before it is deleted (0 = never).
ended_days = 14
`;
