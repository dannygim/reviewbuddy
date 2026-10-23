# 0001. Bun で実装し、単一バイナリとして配る

- status: accepted
- date: 2026-10-23

## Context

akapen は、ローカルで起動する HTTP / WebSocket サーバーと、ブラウザで動く SPA からなる。利用者 (同僚を含む) の手元に Node.js などのランタイムを用意させずに、1 コマンドで入れて起動できるようにしたい。フロントエンドのビルドツール (Vite など) や、サーバーのフレームワークを足すと依存とビルドの手順が増える。

調査: [Bun_調査.md](../research/Bun_調査.md)

## Decision

**Bun 1.4 の `Bun.serve` (HTML import + WebSocket pub/sub) で SPA と API を 1 プロセスにまとめ、`bun build --compile` で OS / arch ごとの単一バイナリにして配る。**

## Options considered

- **Bun + `--compile`** (採用): フロントエンドのバンドル・WebSocket・SQLite・TOML が組み込み — 依存が少なく、利用側にランタイムが要らない / バイナリが 100MB 前後と大きい。Bun 1.4 は Rust で書き直された最初の系列で、退行の可能性がある
- **Node.js + Vite + Express (npm で配布)**: 事例が多く安定している — 依存とビルド手順が増える。利用側に Node.js が要る
- **Go + 埋め込み SPA**: バイナリが小さい — フロントエンドのビルドに別の道具が要り、サーバーとクライアントで型を共有できない

## Consequences

- 依存はサーバー側 `markdown-it` / `shiki` / `ignore`、クライアント側 `react` / `react-dom` / `mermaid` / `dompurify` に絞れる。型チェック・整形・テストも Bun の組み込み (`bun check` / `bun fmt` / `bun test`) で済む
- Bun のバージョンを `mise.toml` で固定し、上げるときはビルドのスモークテストで確かめる必要がある
- コンパイルしたバイナリは、既定で実行時のカレントディレクトリの `.env` と `bunfig.toml` を読む。ビルドには `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` を必ず付ける
- バイナリのサイズが問題になったら、Shiki の言語の絞り込みを先に行い、それでも足りなければ見直す
