# akapen

**akapen** (赤ペン, "red pen") — mark up docs and code together, then hand the comments to your coding agent.

Run `akapen` in a directory and open the URL. Everyone you share it with sees the same file tree, can comment on lines of code or blocks of rendered Markdown, reply, and resolve. When you are done, copy the open threads as a prompt for your coding agent; as the agent edits the files, the page updates and the comments follow their lines.

- One command, one binary: no database or account to set up
- GitHub-like file viewer: syntax highlighting, Markdown preview with Mermaid diagrams
- Comments on source lines or Markdown blocks, with replies, resolve, and live updates for everyone
- Prompt export: `path:line` plus the commented lines and the whole thread
- Read-only toward your files: akapen writes only to `~/.config/akapen/`

## Install

akapen is distributed as a single binary through GitHub Releases, installed with [mise](https://mise.jdx.dev):

```sh
mise use -g github:dannygim/akapen
akapen --version
```

Binaries are built for macOS (Apple silicon) and Linux (x64, arm64).

While the repository is private, mise needs a GitHub token that can read it. If you use the GitHub CLI, let mise ask it for one:

```sh
mise settings set github.credential_command 'gh auth token --hostname "$MISE_CREDENTIAL_HOST"'
```

(gh usually keeps its token in the macOS keychain, where mise cannot read it directly.) Alternatively, set `MISE_GITHUB_TOKEN` to a fine-grained token with read access to the repository's contents. `mise token github` shows which token mise will use. People who only open akapen in a browser need nothing.

## Use

```sh
cd your-project
akapen            # or: akapen path/to/dir
# akapen 0.1.0 is reviewing /Users/me/your-project
#   http://127.0.0.1:4400/
```

Open the URL, pick a nickname, and choose a file.

- **Comment on code**: click a line number, Shift+click or drag to select a range, then write a comment.
- **Comment on Markdown**: in the Preview tab, hover a block and click **+** (Shift+click another block to extend).
- **Copy a prompt**: open **Review**, choose threads (all open ones by default), and click **Copy prompt**. Copied threads are marked **Sent**; tick **Resolve copied threads** to resolve them as well.
- **End the session**: **End** makes the session read-only for everyone.

Starting akapen again in the same directory resumes the same session. `akapen --new` starts a fresh one.

### Sharing with your team over Tailscale

akapen listens on `127.0.0.1` by default. The recommended way to share it is [`tailscale serve`](https://tailscale.com/docs/features/tailscale-serve), which gives your tailnet an HTTPS address and keeps akapen on localhost:

```sh
akapen --port 4400      # a fixed port, so the proxy keeps pointing at it
tailscale serve 4400
```

Alternatively, listen on all interfaces with `akapen --host 0.0.0.0` and share `http://<tailscale-ip>:4400/`. Over plain HTTP the browser's clipboard API is unavailable, so **Copy prompt** falls back to a dialog where you copy the text yourself. If you connect with a MagicDNS short name, add it to `server.allowed_hosts` in the config.

### Exporting from the command line

```sh
akapen export | pbcopy                       # open threads of this directory's session, as a prompt
akapen export --status all --format jsonl    # everything, one JSON object per thread
```

### Sessions

Comments are stored per session under `~/.config/akapen/sessions/` (or `$XDG_CONFIG_HOME/akapen`, or `$AKAPEN_HOME`).

```sh
akapen session ls [--all]        # list sessions
akapen session end [dir|id]      # end a session (read-only)
akapen session reopen <id>       # reopen an ended session
akapen session rm <id...>        # delete sessions
akapen session prune [--dry-run] # apply the retention rules now
```

Sessions without activity for 60 days are ended, and ended sessions are deleted after 14 days (both configurable).

## Configuration

All settings are optional. `akapen config init` writes a commented `config.toml` with the defaults; `akapen config show` prints the effective values. Precedence: command-line flags > `AKAPEN_PORT` / `AKAPEN_HOST` > `config.toml` > defaults.

```toml
[server]
host = "127.0.0.1"
# port = 4400            # setting a port makes it fixed (no fallback to the next free port)
open_browser = false
allowed_hosts = []       # extra host names, e.g. a MagicDNS short name

[viewer]
max_highlight_bytes = 2000000
exclude = []             # hide more files, gitignore syntax, e.g. ["*.lock"]

[prompt]
preamble = ""            # text placed before the threads
max_anchor_lines = 30
resolve_on_copy = false

[retention]
idle_days = 60           # 0 = never end idle sessions
ended_days = 14          # 0 = never delete ended sessions
```

## Security

akapen has no login: anyone who can reach it can read the files it shows and comment. It is meant for people you trust, for example on your tailnet. It refuses requests whose `Host` header is not an IP address, `localhost`, a `*.ts.net` name or a configured name (against DNS rebinding), requires a per-server token for writes and WebSockets (against CSRF and cross-site WebSocket hijacking), only serves files in the file list (nothing ignored by `.gitignore`, nothing outside the directory), and never loads the reviewed directory's `.env`. See [docs/design/セキュリティ.md](docs/design/セキュリティ.md).

## Development

Requires [Bun](https://bun.com) 1.4.4 (pinned in `mise.toml`).

```sh
bun install
bun run dev       # serve this repository with hot reload
bun run verify    # type check, format check, tests (including browser tests)
bun run build     # single binary at dist/akapen
AKAPEN_E2E_BACKEND=chrome bun test   # run the browser tests on Chrome, as CI does on Linux
```

Design documents, decisions and plans live in [`docs/`](docs/README.md) (in Japanese).

## License

[MIT](LICENSE)
