# CLI 仕様

**目的: `akapen` コマンドの起動方法・サブコマンド・オプション・環境変数・終了コードを定める。**

- 対象の要件: F1 / F12 / F13 ([要件.md](./要件.md))
- 実装の状態: 起動 (`akapen [dir]`) の `--port` / `--host` / `--version` / `--help` は M0、`--new` / `--session` と多重起動の検知は M3、`akapen export` は M5、`session` / `config` サブコマンド・`--open` / `--no-open` / `--no-watch`・環境変数・起動時の自動 prune は M6 で実装済み

***

## コマンド

```text
akapen [dir]                       # 起動 (dir を省略するとカレントディレクトリ)。同じルートの active なセッションがあれば再開する
  -p, --port <number>              # 既定: AKAPEN_PORT → config の server.port → 4400
  -H, --host <address>             # 既定: AKAPEN_HOST → config の server.host → 127.0.0.1
      --new                        # 既存の active なセッションを終了して新しく作る
      --session <id>               # 指定したセッションを開く (ended なら read-only)
      --open / --no-open           # ブラウザを開くか (既定: config の server.open_browser → 開かない)
      --no-watch                   # ファイルの監視を無効にする
  -v, --version                    # バージョンを出す
  -h, --help                       # 使い方を出す

akapen export [dir]                # コメントを標準出力へ (既定は dir の active なセッション)
      --session <id>
      --status open|resolved|all   # 既定 open
      --format prompt|jsonl        # 既定 prompt

akapen session ls [--all]          # セッションの一覧 (既定は active のみ)
akapen session end [dir|id]        # セッションを終了する (read-only にする)
akapen session reopen <id>         # 終了したセッションを再開する
akapen session rm <id...>          # 削除する (起動中のものは不可)
akapen session prune [--dry-run]   # 保持期間を過ぎたものを削除する

akapen config init                 # コメント付きの雛形を作る (既存のものは上書きしない)
akapen config path                 # 設定ファイルのパスを出す
akapen config show                 # 反映後の設定値を出す
```

***

## 振る舞いの規則

### サブコマンドの振り分け

- 最初の位置引数が `export` / `session` / `config` ならサブコマンドとして扱う
- 同じ名前のディレクトリを開くときは `akapen ./export` のようにパスとして書く
- `akapen export` は、`--session` が無ければルートの active なセッションを読む。無ければ終了コード 1 (`akapen: No active session for <root>. ...`)

### セッションの指定

- `--session <id>` を指定すると、そのセッションの `root` を開く。ディレクトリの引数や `--new` とは併用できない (使い方の誤りとして終了コード 2)
- 存在しない ID は終了コード 1 (`akapen: Session not found: <id>`)

### ポート

- ポートを**指定していない**とき (既定値の 4400 を使うとき) は、使用中なら次の空きポートを最大 20 個先まで試す
- ポートを**明示した**とき (`--port`、`AKAPEN_PORT`、`config.toml` の `server.port` のいずれか) は、使用中ならエラーで終了する。`tailscale serve 4400` のような外部のプロキシが指すポートから黙って移らないようにするため

### 起動時の出力

```text
akapen 0.1.0 is reviewing /Users/me/work/project
  http://127.0.0.1:4400/
```

- 多重起動を検知したとき (同じルートのサーバーが動いている) は、既存の URL を出して終了コード 0 で終わる ([保存先とセッション.md](./保存先とセッション.md))
- 自動で削除したセッションがあれば 1 行のログを出す

### 環境変数

| 変数 | 意味 |
|------|------|
| `AKAPEN_PORT` | 待ち受けるポート (明示扱い) |
| `AKAPEN_HOST` | 待ち受けるアドレス |
| `AKAPEN_HOME` | 設定とセッションの置き場所 ([保存先とセッション.md](./保存先とセッション.md)) |
| `XDG_CONFIG_HOME` | `AKAPEN_HOME` が無いときの置き場所の基準 |

### 終了コード

| コード | 意味 |
|--------|------|
| `0` | 成功 (多重起動を検知して既存の URL を出した場合を含む) |
| `1` | 実行時のエラー (ポートが使用中、設定ファイルの値が不正、セッションが見つからないなど) |
| `2` | 使い方の誤り (不明なオプション、不正な値、ディレクトリが無いなど)。メッセージの後に Usage を出す |

エラーは `akapen: <理由>` の形で標準エラーに出す。
