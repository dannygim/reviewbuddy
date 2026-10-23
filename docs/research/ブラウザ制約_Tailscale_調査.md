# ブラウザの制約と Tailscale 経由のアクセス 調査

**目的: tailnet 内の同僚が akapen にアクセスするときに効いてくるブラウザの制約 (安全なコンテキスト) と、`tailscale serve` の挙動を確認日付きで記録する。**

***

## 用語

- **安全なコンテキスト (secure context)**: HTTPS か `localhost` で読み込まれたページ。一部の Web API はここでしか使えない
- **tailnet**: Tailscale でつながった端末のネットワーク

***

## 前提

- 調査日: 2026-10-23
- 凡例: **確認済** = 公式ドキュメントで確認したもの / **要検証** = 記載がなく未確認のもの
- akapen は既定で `127.0.0.1:4400` で待ち受ける。リモートからの共有の手段はツールの責務外とし、README で `tailscale serve` を案内する ([全体設計.md](../design/全体設計.md))

***

## 仕様サマリー

### 安全なコンテキストが必要な API

| API | 制約 | 確度 | akapen での影響 |
|-----|------|------|----------------|
| `navigator.clipboard` (Clipboard API) | メソッドはすべて安全なコンテキストが必須 | 確認済 (MDN) | プロンプトのコピーにフォールバックが要る |
| `crypto.randomUUID()` | 安全なコンテキスト限定 | 確認済 (MDN) | `client_id` の生成に使えない |
| `crypto.getRandomValues()` | 制限なしのはず | 要検証 | `client_id` の生成はこちらを使う |

`http://100.x.y.z:4400` (Tailscale の IP に直接) や、MagicDNS 名への `http://` でのアクセスは安全なコンテキストにならない。

### `tailscale serve`

- `tailscale serve 4400` で、tailnet の DNS 名による HTTPS (証明書は自動発行。tailnet で HTTPS を有効にしておく必要がある) + localhost へのプロキシになる → 安全なコンテキストになり、`127.0.0.1` で待ち受けたまま共有できる **確認済** (Tailscale docs)
- バックエンドへのリクエストに `Tailscale-User-Login` / `Tailscale-User-Name` / `Tailscale-User-Profile-Pic` を付ける。タグ付きのデバイスからのアクセスと Funnel 経由では付かない。クライアントが同じ名前のヘッダーを送ってきた場合は除去する (偽装対策) **確認済**
- `tailscale serve` 経由で WebSocket が通るか: ドキュメントに記載なし **要検証**

***

## 重要な気づき

- **`http://` で直接つなぐとクリップボードへの書き込みができない**。コピーは `navigator.clipboard.writeText()` → 非表示 textarea + `execCommand('copy')` → 全文を選択済みの textarea をモーダルで出す、の順にフォールバックさせる ([プロンプト出力仕様.md](../design/プロンプト出力仕様.md))
- **`client_id` は `crypto.getRandomValues()` で作る**
- **推奨は `tailscale serve`**。HTTPS になり、`127.0.0.1` のまま共有できる。`--port` を明示したときに別のポートへ移らないのは、`tailscale serve 4400` が指す先をずらさないため ([CLI_仕様.md](../design/CLI_仕様.md))
- **`Tailscale-User-Login` で Nickname を自動入力できる余地がある** (v1 で使うかは未決)
- **WebSocket が `tailscale serve` を通るかは M4 で手動確認する**

***

## 出典

> 出典: [MDN — Clipboard](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard) (確認日: 2026-10-23)

> 出典: [MDN — Crypto: randomUUID()](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID) (確認日: 2026-10-23)

> 出典: [Tailscale — Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) (確認日: 2026-10-23)
