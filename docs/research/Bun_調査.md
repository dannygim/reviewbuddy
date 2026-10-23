# Bun 調査

**目的: akapen が依存する Bun 1.4 の機能 (サーバー、単一バイナリ、SQLite、TOML、組み込みの開発ツール) の仕様と制約を、確認日付きで記録する。**

***

## 前提

- 調査日: 2026-10-23
- 凡例: **確認済** = 公式ドキュメント (一次ソース) か、手元で実行して確認したもの / **要検証** = 二次ソースや推測。実装時に確認する
- 検証環境: Linux コンテナ上の Bun 1.4.4 (初回の調査)、macOS (Apple silicon) 上の Bun 1.4.4 (M0 の実装時)

***

## 仕様サマリー

### バージョン

| 項目 | 内容 | 確度 |
|------|------|------|
| 最新版 | 1.4.4 (2026-10-22) | 確認済 |
| 1.4 | 2026-08-20 リリース。本体が Rust で書き直された最初のリリース | 確認済 |
| 1.4 の関連機能 | `Bun.serve` の `{ dir }` ルートによるディレクトリ配信 (`ETag` / `304` / `Range` 対応)、本番で HTML ルートのソースマップを配信しない、`--compile` の `--asset`、ヘッドレスブラウザ `Bun.WebView` | 確認済 |

### Bun.markdown

| 項目 | 内容 | 確度 |
|------|------|------|
| 導入 | v1.3.8。md4c の Zig 移植として追加 (1.4 で Bun 本体は Rust 化) | 確認済 |
| API | `html()` / `render()` (要素ごとのコールバック) / `react()` / `ansi()` | 確認済 (1.4.4 で `Object.keys(Bun.markdown)` を実行) |
| 既定の拡張 | `tables` / `strikethrough` / `tasklists` が既定で有効。`autolinks` / `headings` (id 付与) / `wikiLinks` / `latexMath` / `underline` などはオプション | 確認済 |
| コードブロック | `code` コールバックに `{ language }` が渡る。`mermaid` だけ分岐して独自の HTML を返すことはできる | 確認済 (実行) |
| ソース位置 | **なし**。オプション・メタ情報・AST API のいずれにも行番号はない。実行すると `paragraph` のメタは `undefined`、`heading` は `{ level }` のみ | 確認済 (リファレンス + 実行) |
| サニタイズ | **しない**。`<script>` も `javascript:` の href もそのまま出力される | 確認済 (実行) |
| ハイライト | 内蔵なし。Shiki などで後処理が必要 | 確認済 |
| 安定性 | ドキュメント上「開発中で今後変更の可能性あり」 | 確認済 |

「ブロックごとに分割して `Bun.markdown.html()` を個別に呼び、行範囲を自前で付ける」案も検討した。次の理由で採用するメリットがない。

- 分割のために、結局別のパーサーが要る
- 参照リンクの定義 (`[x]: url`) がブロックをまたいで解決できない
- 粒度が最上位のブロック止まりで、リスト項目単位にならない

### Bun.serve / HTML import / WebSocket

- HTML ファイルを import して `routes` に渡すと、`<script>` / `<link>` をバンドル (TS / JSX もトランスパイル) して配信する。API ルートと同居できる (v1.2.3+) **確認済**
- `development: true` で HMR、`development: { console: true }` でブラウザの console 出力をターミナルに流せる **確認済**。M0 で `bun --hot` + `development: true` のとき、ページを再読み込みせずに React のコンポーネントが更新されることを確認した **確認済** (実行)
- 本番は AOT (`bun build --target=bun --production`、v1.2.17+) か、`development: false` での実行時バンドル + メモリキャッシュ **確認済**
- `routes` に該当せず `fetch` も無いリクエストへの応答は、`fetch: () => new Response("Not Found", { status: 404 })` を置いて明示する (M0 の実装) **確認済** (実行)
- 使用中のポートで `Bun.serve` を呼ぶと、`code: "EADDRINUSE"` のエラーを同期的に投げる (メッセージは `Failed to start server. Is port <port> in use?`) **確認済** (実行)
- WebSocket: `server.upgrade(req, { data })` → `websocket: { open, message, close, ... }`。`ws.subscribe(topic)` と `server.publish(topic, msg)` で全員へ配信する (`ws.publish` は送信者以外へ)。`ws.data` の型は `websocket.data` フィールドで指定する (`Bun.serve<T>()` のジェネリクスは廃止) **確認済**
- ドキュメントは、upgrade の前に `Origin` ヘッダーを検証するよう推奨している (Cross-Site WebSocket Hijacking 対策) **確認済**
- ファイル監視: `node:fs` の `fs.watch(dir, { recursive: true })` を使う想定。macOS / Linux の両方で recursive が期待どおり動くか、大量ファイル時の負荷 **要検証**

### bun build --compile

- サーバー + HTML import のフロントエンドを 1 つの実行ファイルにできる (v1.2.17+) **確認済**
- `--compile` は `--production` を含み、`NODE_ENV=production` が埋め込まれる **確認済** (`bun build --help`)
- クロスコンパイル: `--target=bun-darwin-arm64` / `bun-linux-x64` / `bun-windows-x64` など **確認済**
- **既定では、実行時のカレントディレクトリの `.env` と `bunfig.toml` を読み込む**。`--no-compile-autoload-dotenv` / `--no-compile-autoload-bunfig` で止められる **確認済** (実行。`.env` を置いたディレクトリで、フラグなしのバイナリは値を読み、フラグありのバイナリは読まなかった)
- 本番向けに推奨されているフラグ: `--minify` / `--sourcemap` (スタックトレースが元のソースを指す) / `--bytecode` (起動の高速化) **確認済**。M0 のバイナリでも、エラー時のスタックトレースが `src/server.ts:28:14` のように元のソースを指した **確認済** (実行)
- `--sourcemap` を付けると、出力先に `.map` ファイルも書き出される **確認済** (実行)
- **HTML import のフロントエンドは、既定では動的 import を別のチャンクに分けない** (開発モードでも `--compile` でも 1 ファイルになる)。`--compile --splitting` を付けると、フロントエンドもサーバーも分割され、分割したチャンクを実行時に読み込む **確認済** (実行。M2 で Mermaid を含む 5.7MB の初回の JS が 458KB になった)
- `--splitting` を付けると、サーバー側の動的 import (`import("...")`) の先もすべてチャンクとして埋め込まれる。Shiki の `bundledLanguagesInfo` のように全言語の動的 import を持つものを使うと、使わない言語までバイナリに入る (101MB → 112.5MB)。使う言語だけを静的なパスで import すれば避けられる (105.7MB) **確認済** (実行)
- `--bytecode` の出力は、`--format` を省略すると CommonJS になる。ESM のバイトコードは `--compile` と `--format=esm` の両方が必要。バイトコードは Bun のバージョン間で互換性がない **確認済** (`@types/bun` 1.4.4 同梱のドキュメント)
- バイナリのサイズ: HTML import + Shiki + WebSocket の最小サーバーで約 114MB (Linux x64、Shiki の全言語・テーマを含む)。M0 の時点 (React のみ、Shiki なし) では約 92MB (macOS arm64) **確認済** (実行)
- サイズ削減: `shiki/core` + Oniguruma エンジン + 使う言語 (約 40) だけを読み込むと、M1 のバイナリは `--minify --sourcemap` で 101MB (macOS arm64)。WASM も単一バイナリの中で動く **確認済** (実行)
- `--bytecode` の効果 (M1 のバイナリ、macOS arm64): サイズが 101.0MB → 112.4MB に増え、起動 (URL を出すまで) は 35ms → 22ms になる **確認済** (実行)。akapen では付けない ([M1_ツリーとコード表示_詳細計画.md](../plan/M1_ツリーとコード表示_詳細計画.md) の計測結果)
- macOS の署名: ドキュメントは `codesign` での署名と、JIT 権限を含む `entitlements.plist` の付与を推奨している (v1.2.4+)。Linux からクロスコンパイルした darwin バイナリを Linux 上で署名できるかは記載なし → darwin 版は macOS ランナーでビルド・署名する **確認済** (記載内容) / mise 経由のダウンロードで Gatekeeper の警告が出ないこと **要検証**

### bun:sqlite

- `import { Database } from "bun:sqlite"`。公式は WAL を推奨している: `db.run("PRAGMA journal_mode = WAL;")` **確認済**
- `db.query()` (キャッシュあり) / `db.prepare()` (キャッシュなし)、名前付きパラメータ (`$x` / `:x` / `@x`)、`db.transaction(fn)` **確認済**
- `db.transaction(fn)` の `fn` は同期関数のみ。`await` 以降はトランザクションの外になる **確認済**
- `strict: true` で、指定していないパラメータをエラーにできる **確認済**

### Bun.TOML

- Bun 1.4.4 には `Bun.TOML.parse` と `Bun.TOML.stringify` がある。`[server] port = 4400` のような設定を依存なしでオブジェクトに変換できる **確認済** (実行)
- `stringify` はコメントを保持しない。コメント付きの雛形はテキストとして持つ

### 組み込みの開発ツール

| ツール | 内容 | 確度 |
|--------|------|------|
| `bun check` | `tsconfig.json` を読み、TypeScript 7 の `tsc` と同じエラーを報告する型チェッカー。`typescript` パッケージは不要 | 確認済 (`bun check --help`、同梱ドキュメント、実行) |
| `bun fmt` | Prettier と同じ出力のフォーマッター。JS / TS / CSS / HTML / JSON / YAML / TOML / Markdown などが対象。`.gitignore` の対象は飛ばす | 確認済 (`bun fmt --help`、同梱ドキュメント) |
| `bun test` | Jest 互換のテストランナー | 確認済 |
| `bun lint` | 組み込みのリンター。canary ビルドのみで、1.4.4 には無い | 確認済 (同梱ドキュメント) |
| `Bun.WebView` | ヘッドレスブラウザ (実験的)。macOS はシステムの `WKWebView`、Linux / Windows はインストール済みの Chrome 系を Chrome DevTools Protocol で操作する | 確認済 (同梱ドキュメント、M0 の画面確認で実行) |

使い方の注意 (いずれも 2026-10-23 に実行して確認):

- `bun fmt` を引数なしで実行すると、リポジトリの Markdown (`docs/` や `.agents/`) も整形対象になる
- `bun fmt` に存在しないパスを渡すとエラーで終了する (`No files matching the pattern were found`)
- `package.json` に `check` という名前のスクリプトがあると、`bun check` は組み込みの型チェックではなくそのスクリプトを実行する。`build` という名前のスクリプトがあっても、`bun build` は組み込みのバンドラーが動く

***

## 重要な気づき

- **Bun.markdown はソース位置を返さない**ため、Preview 上で行にひも付くコメントを付ける要件と合わない。v1 では markdown-it を使う ([レンダリング_調査.md](./レンダリング_調査.md))
- **コンパイルしたバイナリは、何も指定しないと実行時のカレントディレクトリの `.env` を読む**。akapen はレビュー対象のディレクトリで起動されるため、対象プロジェクトの秘密情報が akapen の環境変数に入りうる。ビルドには `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` を必ず付ける
- **`bun check` / `bun fmt` が組み込まれている**ため、`typescript` や Biome / Prettier を開発用の依存に入れずに済む。ただし `bun fmt` の対象は `src` / `test` に限り、スクリプト名に `check` / `fmt` を使わない
- **`fs.watch` の recursive の挙動は未検証**。ファイル監視 (A1) を作る M6 の最初に確認する

***

## 出典

> 出典: [Bun — endoflife.date](https://endoflife.date/api/v1/products/bun/) (確認日: 2026-10-23)

> 出典: [Bun 1.4](https://bun.com/blog/bun-v1.4) (確認日: 2026-10-23)

> 出典: [Bun 1.3.8 (Bun.markdown の導入)](https://bun.com/blog/bun-v1.3.8) (確認日: 2026-10-23)

> 出典: [Bun — Markdown](https://bun.com/docs/runtime/markdown) (確認日: 2026-10-23)

> 出典: [Bun — Markdown reference](https://bun.com/reference/bun/markdown) (確認日: 2026-10-23)

> 出典: [Bun — Fullstack dev server](https://bun.com/docs/bundler/fullstack) (確認日: 2026-10-23)

> 出典: [Bun — WebSockets](https://bun.com/docs/runtime/http/websockets) (確認日: 2026-10-23)

> 出典: [Bun — Single-file executable](https://bun.com/docs/bundler/executables) (確認日: 2026-10-23)

> 出典: [Bun — SQLite](https://bun.com/docs/runtime/sqlite) (確認日: 2026-10-23)
