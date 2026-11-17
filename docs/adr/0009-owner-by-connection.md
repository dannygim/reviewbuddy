# 0009. 起動したマシンから直接つないだブラウザを Owner とする

- status: accepted
- date: 2026-11-17

## Context

reviewbuddy を起動した本人は、`.gitignore` で除外されたファイル (ローカルのメモ、生成物、`.env` など) も reviewbuddy で見たい。一方で、参加者には今までどおり見せたくない。また、プロンプトを Coding Agent に渡すのは起動した本人なので、`Copy prompt` も本人に限りたい。

[ADR-0007](./0007-access-pin.md) では、起動した本人も参加者と同じ PIN を入力し、画面での扱いを分けていない。PIN を知る人はみな同じ権限を持つので、起動した本人を見分ける仕組みが無い。

見分けるときの制約:

- 推奨している共有の方法は `tailscale serve` で、バックエンドから見た接続元は全員 `127.0.0.1` になる ([セキュリティ.md](../design/セキュリティ.md))
- ただし `tailscale serve` は、転送するリクエストに `X-Forwarded-For` / `X-Forwarded-Host` を付け、`Host` はクライアントが送った ts.net の名前のまま渡す
- 通話で画面を共有しながら使うので、ターミナルに表示した文字列は相手に見えうる

調査: [ブラウザ制約_Tailscale_調査.md](../research/ブラウザ制約_Tailscale_調査.md) / [Bun_調査.md](../research/Bun_調査.md) (`server.requestIP`)

## Decision

**次の 3 つをすべて満たすリクエストを Owner (起動した本人) のものとし、ignored ファイルの閲覧、ignored ファイルのスレッドへの書き込み、`Copy prompt` を Owner に限る。** PIN ([ADR-0007](./0007-access-pin.md)) はそのままで、Owner も入力する。

1. 接続元 (`server.requestIP(req)`) が loopback (`127.0.0.0/8`、`::1`、`::ffff:127.0.0.0/104`)
2. `Host` のホスト名が、同じマシンを指す名前 (`localhost`、`127.0.0.0/8`、`[::1]`、`0.0.0.0`、`[::]`)
3. `X-Forwarded-For`・`X-Forwarded-Host`・`Forwarded` のどれも付いていない

判定はリクエストごとに行い、Cookie には持たせない。WebSocket は upgrade のリクエストで判定する。詳細: [セキュリティ.md](../design/セキュリティ.md#owner)

## Options considered

- **接続元・`Host`・転送のヘッダーで決める** (採用): 何も操作しなくてよい。`tailscale serve` 経由の人と `--host 0.0.0.0` で LAN からつなぐ人は参加者になる。画面共有で漏れるものも無い — Owner も `127.0.0.1` などの URL で直接開く必要がある。TCP のまま転送する仕組みを通すと見分けられない
- **接続元が loopback かだけで決める**: 最小 — `tailscale serve` 経由の全員が Owner になる
- **Owner 用のリンク** (起動ごとのトークンを URL の `#` 以降に入れてターミナルに表示し、開いたブラウザに Owner の Cookie を付ける): どの経路で開いても Owner になれる — リンクを誤って共有すると Owner の権限が渡る。ターミナルを画面共有すると映る
- **Owner 用の PIN** (2 つ目の 6 桁): 今のログインの画面のまま — 画面共有で読める。2 つの PIN を言い間違えやすい

## Consequences

- Owner は追加の操作なしで決まる。画面では、Owner にだけ ignored ファイルの表示・非表示のボタンと `Copy prompt` が出る
- 参加者は `Copy prompt` を使えなくなる。CLI の `reviewbuddy export` は同じマシンで DB を直接読むので、今までどおり使える
- Owner でも、自分で ts.net の URL を開くと参加者として扱われる。README で、Owner は `http://127.0.0.1:<port>/` を開くよう案内する
- TCP のまま転送する仕組み (`tailscale serve --tcp`、`ssh -R`、`socat` など) を通すと、その先の人も Owner として扱われる。README とセキュリティ.md に書く。Owner 本人が `ssh -L` で転送して開く場合は、Owner のまま使える
- 同じマシンの他の OS ユーザーも Owner になる。`reviewbuddy export` と同じく、同じマシンのユーザーは信頼する前提とする
- `X-Forwarded-*` を付けず、`Host` も `127.0.0.1` に書き換えるリバースプロキシを通すと、全員が Owner になる。案内する共有の方法は `tailscale serve` に限る
- 同じマシンのブラウザは全員 Owner になるため、E2E で参加者を再現するには、テストから Owner の判定を差し替える仕組みが要る
- Tailscale の ID ヘッダー (`Tailscale-User-Login`) で本人を確かめる方式 (v2 候補) を入れるときに、この決定を見直す
