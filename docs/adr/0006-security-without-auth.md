# 0006. 認証なしのまま、Host の許可リストとトークンでブラウザ経由の攻撃を防ぐ

- status: accepted
- date: 2026-10-23

## Context

akapen は信頼できる同僚との tailnet 内での利用を前提にしており、ログインなどの認証は持たない (Nickname は自己申告)。一方で、ソースコードを HTTP で配信するため、利用者が同じブラウザで開いた悪意あるサイトから、DNS rebinding でファイルを読まれたり、CSRF でコメントを書き込まれたり、WebSocket でコメントを盗み見られたりする可能性がある。要件で明示されていたのは WebSocket の `Origin` 検証だけだった。

調査: [ブラウザ制約_Tailscale_調査.md](../research/ブラウザ制約_Tailscale_調査.md)

## Decision

**認証は入れない。代わりに、(1) `Host` ヘッダーの許可リスト (IP リテラル / `localhost` / `*.ts.net` / 設定した名前)、(2) サーバーの起動ごとのトークンを書き込み API と WebSocket で必須にする、(3) WebSocket の upgrade 前の `Origin` 検証、の 3 つを入れる。**

詳細: [セキュリティ.md](../design/セキュリティ.md)

## Options considered

- **Host の許可リスト + トークン + Origin 検証** (採用): ログインなしのまま、ブラウザ経由の攻撃 (DNS rebinding / CSRF / CSWSH) を防げる — MagicDNS の短い名前でつなぐ場合は `server.allowed_hosts` の設定が要る
- **WebSocket の `Origin` 検証のみ (要件どおり)**: 最小 — DNS rebinding と CSRF が残る
- **`Origin` と `Host` の一致だけで判定**: 設定が要らない — `tailscale serve` を通すと `Host` が書き換わる可能性があり、正しい利用を拒否しうる。`*.ts.net` を一律に許すと、Funnel で公開された他人のページを通してしまう
- **認証 (パスワードや Tailscale の ID ヘッダー)**: 強い — 設定なしで使えるという方針に反する

## Consequences

- トークンは SPA が `GET /api/session` で受け取るため、利用者の操作は増えない
- `akapen export` などの CLI は DB を直接読むため、トークンに関係しない
- tailnet 内の人は誰でもコメントでき、Nickname の偽装も防げない (前提として受け入れる)
- `Host` の許可リストに当てはまらない名前でつなぐ人には、`server.allowed_hosts` の設定を案内する必要がある
