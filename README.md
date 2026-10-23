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

mise holds back releases younger than 24 hours by default (`minimum_release_age`), so `mise upgrade` only offers a new akapen release the day after it is published. To take it right away:

```sh
mise upgrade github:dannygim/akapen --minimum-release-age 0s
# or exempt akapen from the delay for good:
mise settings add minimum_release_age_excludes github:dannygim/akapen
```

While the repository is private, mise needs a GitHub token that can read it. If you use the GitHub CLI, let mise ask it for one:

```sh
mise settings set github.credential_command 'gh auth token --hostname "$MISE_CREDENTIAL_HOST"'
```

(gh usually keeps its token in the macOS keychain, where mise cannot read it directly.) Alternatively, set `MISE_GITHUB_TOKEN` to a fine-grained token with read access to the repository's contents. `mise token github` shows which token mise will use. People who only open akapen in a browser need nothing.

## Use

```sh
cd your-project
akapen            # or: akapen path/to/dir
# akapen 0.2.0 is reviewing /Users/me/your-project
#   http://127.0.0.1:4400/
#   PIN: 482 913
```

Open the URL, enter a nickname and the PIN, and choose a file. Share the URL and the PIN with the people you review with — for example, say the PIN in the call instead of posting it next to the URL. The PIN changes every time akapen starts, so everyone enters it again after a restart.

- **Comment on code**: click a line number, Shift+click or drag to select a range, then write a comment.
- **Comment on Markdown**: in the Preview tab, hover a block and click **+** (Shift+click another block to extend).
- **Copy a prompt**: open **Review**, choose threads (all open ones by default), and click **Copy prompt**. Copied threads are marked **Sent**; tick **Resolve copied threads** to resolve them as well.
- **End the session**: **End** makes the session read-only for everyone.

Starting akapen again in the same directory resumes the same session. `akapen --new` starts a fresh one.

### Sharing with your team over Tailscale

akapen listens on `127.0.0.1` by default. The recommended way to share it is [`tailscale serve`](https://tailscale.com/docs/features/tailscale-serve), which gives your tailnet an HTTPS address and keeps akapen on localhost:

```sh
akapen --port 4400      # a fixed port, so the proxy keeps pointing at it
tailscale serve 4400    # https://<machine>.<tailnet>.ts.net/
```

If `tailscale serve` answers `listener already exists for port 443`, this machine already serves something else on 443 (see `tailscale serve status`). Serve akapen on another HTTPS port instead:

```sh
tailscale serve --https=8443 4400    # https://<machine>.<tailnet>.ts.net:8443/
```

Don't use `--set-path` to put akapen under a sub-path: the app loads its API and assets from absolute paths.

Alternatively, listen on all interfaces with `akapen --host 0.0.0.0` and share `http://<tailscale-ip>:4400/`. Over plain HTTP the browser's clipboard API is unavailable, so **Copy prompt** falls back to a dialog where you copy the text yourself. If you connect with a MagicDNS short name, add it to `server.allowed_hosts` in the config.

### Sharing with people who don't use Tailscale

- **[Tailscale Funnel](https://tailscale.com/kb/1223/funnel)** puts akapen on the public internet, so a browser is all they need. Anyone who finds the URL can reach it, and only the PIN keeps them out — use akapen 0.2.0 or later, and turn Funnel off when you are done. Funnel needs the `funnel` attribute in your tailnet policy (approve it when the first `tailscale funnel` asks), and only ports 443, 8443 and 10000:

  ```sh
  akapen --port 4400
  tailscale funnel --bg --https=8443 4400   # https://<machine>.<tailnet>.ts.net:8443/
  tailscale funnel --https=8443 off         # when you are done
  ```

  A port is either in your tailnet (`serve`) or public (`funnel`), whichever you ran last. On macOS, Tailscale's docs disagree on whether the App Store and Standalone apps support Funnel.
- **[Share the machine](https://tailscale.com/kb/1084/sharing)** (admin console → Machines → your machine → Share) to keep it private. They install Tailscale, sign up for free and accept the invite, then open the full name (`https://<machine>.<tailnet>.ts.net:8443/`; short names don't work for shared machines). If your policy restricts access, allow `autogroup:shared` to the HTTPS port.

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

akapen has no accounts. Each start prints a new 6-digit PIN, and only browsers that entered it can see files and comments (an HttpOnly cookie, forgotten on restart). Wrong PINs are limited to 5 a minute; after 20, akapen refuses every login until you restart it for a new PIN. Over plain HTTP (`--host 0.0.0.0`) the PIN and the cookie travel unencrypted, so prefer `tailscale serve`. Everyone with the PIN can read and comment, and nicknames are not verified. akapen also refuses requests whose `Host` header is not an IP address, `localhost`, a `*.ts.net` name or a configured name (against DNS rebinding), requires a per-server token for writes and WebSockets (against CSRF and cross-site WebSocket hijacking), only serves files in the file list (nothing ignored by `.gitignore`, nothing outside the directory), and never loads the reviewed directory's `.env`. See [docs/design/セキュリティ.md](docs/design/セキュリティ.md).

## Troubleshooting

- **`mise ERROR Config files in .../mise.toml are not trusted`** when running `akapen` inside a project: mise's shims read the project's `mise.toml` first. Run `mise trust` in that project (or review the file first if it is not yours).
- **`listener already exists for port 443`** from `tailscale serve`: another service already uses 443 on this machine; serve akapen with `tailscale serve --https=8443 4400` (see above).
- **Port 4400 is taken**: without `--port`, akapen moves to the next free port and prints the URL. With `--port` (or `AKAPEN_PORT` / `server.port`), it stops instead, so a proxy never points at the wrong port.

## Development

Requires [Bun](https://bun.com) 1.4.4 (pinned in `mise.toml`).

```sh
bun install
bun run dev       # serve this repository with hot reload
bun run verify    # type check, format check, tests (including browser tests)
bun run build     # single binary at dist/akapen
AKAPEN_E2E_BACKEND=chrome bun test   # run the browser tests on Chrome, as CI does on Linux
mise run review   # review this repository with the akapen in src/ (arguments after -- go to akapen)
mise run share    # the same on port 4400, shared with `tailscale serve` on HTTPS port 8443 until Ctrl+C
```

Design documents, decisions and plans live in [`docs/`](docs/README.md) (in Japanese).

## License

[MIT](LICENSE)
