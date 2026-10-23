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
- `tailscale serve` 経由で WebSocket が通る **確認済** (2026-10-23、Tailscale 1.104.1、macOS。`tailscale serve --https=8443 <port>` の HTTPS 経由で `/api/health` と `/ws` の upgrade が通り、プレゼンスのイベントが届いた)
- 同じ端末で 443 番をすでに別のサービスに使っていると、`tailscale serve <port>` は `listener already exists for port 443` で失敗する。`--https=<port>` で別の HTTPS ポートに出せる (`https://<マシン名>.<tailnet>.ts.net:<port>/`) **確認済** (実行)
- `--set-path` でサブパスに出すと、akapen は `/api` や `/ws`・チャンクを絶対パスで読むため動かない (設計から判断。実行はしていない) **要検証**
- 前面モード (`--bg` なし) の `tailscale serve` を SIGTERM で止めると、設定が `Foreground` のエントリとして残り、同じポートに `listener already exists for port <port>` で出せなくなることがある。`tailscale serve status` には出ず、`--json` で見える。`tailscale serve --https=<port> off` では消えず、消せたのは `tailscale serve reset` (他の設定も消える) だけだった **確認済** (2026-10-23、Tailscale 1.104.1、macOS で観測)。止めるときは Ctrl+C を使うか、`--bg` で出して `--https=<port> off` で外す

### Tailscale を使っていない相手への共有

**Funnel** (`tailscale funnel`): ローカルのサービスをインターネットに公開する。

- Tailscale を使っていない人でも、ブラウザだけで開ける (URL に届けば誰でも) **確認済** (Tailscale docs)
- 使うには、MagicDNS、HTTPS の証明書、許可ポリシー (tailnet policy file) の `funnel` ノード属性が要る。属性は、初めて `tailscale funnel` を実行したときに表示される画面で承認すると自動で足される。手で書く場合は `"nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]` **確認済**
- 公開できるポートは 443・8443・10000 だけ **確認済**
- 同じポートで serve と funnel は同時に使えない。最後に実行したコマンドで、そのポートが tailnet 内だけ (serve) か公開 (funnel) かが決まる **確認済**
- 公開 DNS への反映に最大 10 分かかる。帯域に変えられない上限がある **確認済**
- CLI は `tailscale funnel [--bg] [--https=<port>] <target>`、`tailscale funnel status`、`tailscale funnel reset` **確認済** (CLI のヘルプ、1.104.1)
- 止めるときは、始めたときのコマンドの末尾に `off` を付ける。`<target>` は省略できるが、元のフラグは要る (例: `tailscale funnel --https=8443 off`) **確認済**
- macOS: Funnel のドキュメントは「ファイルやディレクトリの公開は open source 版だけ。App Store 版などはポートの公開だけ」と読めるが、macOS の変種の比較表 (Last validated Jan 5, 2026) では Funnel は open source 版 (`tailscaled`) だけが yes になっていて、食い違う。Standalone 版でポートを公開できるかは**要検証**

**マシンの共有** (node sharing): マシン 1 台だけを、別の tailnet のユーザーに共有する。

- 受け手は Tailscale のアカウントとクライアントが要る。招待はメールかリンク (再利用できるリンクは最大 1,000 回、未使用のリンクは 30 日で失効) で送り、受け入れるには受け手が自分の tailnet の Owner / Admin / IT admin である必要がある (新しく登録した人は Owner) **確認済**
- 受け手から見えるのは共有したマシンだけで、そのマシンから受け手の tailnet へは接続できない **確認済**
- MagicDNS は完全な名前 (`<machine>.<tailnet>.ts.net`) でだけ引ける (短い名前は不可) **確認済**
- どのポートに届くかは共有した側の許可ポリシーで決まる。`autogroup:shared` で招待したユーザーをまとめて指定できる。`src: ["*"]` は招待したユーザーにも効く **確認済**
- 受け手が `tailscale serve` の HTTPS の証明書でそのまま開けるかはドキュメントに記載がない (同じ名前で引けるので通る見込み) **要検証**

***

## 重要な気づき

- **`http://` で直接つなぐとクリップボードへの書き込みができない**。コピーは `navigator.clipboard.writeText()` → 非表示 textarea + `execCommand('copy')` → 全文を選択済みの textarea をモーダルで出す、の順にフォールバックさせる ([プロンプト出力仕様.md](../design/プロンプト出力仕様.md))
- **`client_id` は `crypto.getRandomValues()` で作る**
- **推奨は `tailscale serve`**。HTTPS になり、`127.0.0.1` のまま共有できる。`--port` を明示したときに別のポートへ移らないのは、`tailscale serve 4400` が指す先をずらさないため ([CLI_仕様.md](../design/CLI_仕様.md))
- **`Tailscale-User-Login` で Nickname を自動入力できる余地がある** (v1 で使うかは未決)
- **WebSocket は `tailscale serve` を通る**。443 番が使用中なら `--https=8443` などで別のポートに出す
- **Tailscale を使っていない相手には、Funnel (公開。PIN が前提) か、マシンの共有 (相手が Tailscale を入れる) を使う**。Funnel は URL に届けば誰でも開けるため、PIN ([ADR-0007](../adr/0007-access-pin.md)) が無い v0.1 では使えない。公開できるポートは 8443 を含むので、`tailscale serve --https=8443` からの切り替えは `tailscale funnel --https=8443` で済む

***

## 出典

> 出典: [MDN — Clipboard](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard) (確認日: 2026-10-23)

> 出典: [MDN — Crypto: randomUUID()](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID) (確認日: 2026-10-23)

> 出典: [Tailscale — Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) (確認日: 2026-10-23)

> 出典: [Tailscale — Tailscale Funnel](https://tailscale.com/kb/1223/funnel) (確認日: 2026-10-23)

> 出典: [Tailscale — tailscale funnel command](https://tailscale.com/kb/1311/tailscale-funnel) (確認日: 2026-10-23)

> 出典: [Tailscale — Sharing your nodes with other users](https://tailscale.com/kb/1084/sharing) (確認日: 2026-10-23)

> 出典: [Tailscale — Three ways to run Tailscale on macOS](https://tailscale.com/kb/1065/macos-variants) (確認日: 2026-10-23)
