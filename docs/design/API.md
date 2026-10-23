# API

**目的: SPA とサーバーの間の REST API と WebSocket のイベントの一覧を定める。リクエスト・応答・イベントの型の正本は `src/shared/` の TypeScript の型とし、本書は役割と振る舞いを書く。**

- 対象の要件: F2 / F5 / F10 / F12 / F13 / A1 / A3 / A4 ([要件.md](./要件.md))
- 共通の約束: パスはルートからの相対パス・POSIX 区切り、行番号は 1 始まり・両端を含む ([全体設計.md](./全体設計.md))
- 認可: `GET /api/health` と `POST /api/login` 以外は、PIN を入力したブラウザの Cookie が必要 (無ければ `401`)。加えて、書き込み API と WebSocket はトークンが必要 ([セキュリティ.md](./セキュリティ.md))

***

## REST API

| メソッドとパス | 役割 | 書き込み | フェーズ |
|---------------|------|---------|---------|
| `GET /api/health` | 生存確認。アプリ名・バージョン・セッション ID を返す。多重起動の判定に使う。Cookie は要らない (そのため、ルートのパスは返さない) | — | M0 (セッション ID は M3、ルートを外したのは v0.2) |
| `POST /api/login` | `{ "pin" }` を確かめ、正しければ Cookie を付けて `204` を返す。間違いは `401`、形式違いは `400`、回数の上限で `429` / `403` | — | v0.2 |
| `GET /api/session` | セッションの情報 (ID、ルート、状態) とトークン | — | M3 |
| `POST /api/session/end` | セッションを終了する (以後 read-only) | ○ | M6 |
| `GET /api/tree` | ツリー順に並べたファイルのパスの配列 | — | M1 |
| `GET /api/file?path=` | ファイルの種類・行の配列・表示用の HTML・mtime | — | M1 |
| `GET /api/raw?path=` | ファイルの中身そのもの (画像の表示用) | — | M1 |
| `GET /api/threads` | スレッドの一覧 (コメントを含む)。`?path=` で絞り込める | — | M3 |
| `POST /api/threads` | スレッドを作る (パス、行範囲、表示 (`source` / `preview`)、本文、Nickname、`client_id`) | ○ | M3 |
| `POST /api/threads/:id/comments` | リプライを足す | ○ | M3 |
| `PATCH /api/comments/:id` | 自分のコメントを編集する | ○ | M3 |
| `DELETE /api/comments/:id` | 自分のコメントを消す。元コメント (1 件目) はリプライが無いときだけ消せて、スレッドごと消える | ○ | M3 |
| `POST /api/threads/:id/resolve` | Resolve する | ○ | M3 |
| `POST /api/threads/:id/reopen` | Reopen する | ○ | M3 |
| `POST /api/prompt` | 指定したスレッドのプロンプトを生成する。`exported_at` を記録し、指定があれば Resolve する | ○ | M5 |

- 書き込みは `Content-Type: application/json` と `X-Reviewbuddy-Token` が必須
- 終了したセッション (read-only) では、書き込みはすべて `409` を返す
- 自分のもの以外のコメントの編集・削除は `403` を返す (`client_id` で判定する信頼ベースの簡易な制御)
- エラーの応答は `{ "error": "<人が読める英語のメッセージ>" }`
- Cookie が無いときの `401` は `{ "error": "Enter the PIN shown where reviewbuddy was started." }`

***

## WebSocket

- エンドポイント: `GET /ws?token=<token>` で upgrade する (Cookie も必要)
- 全員への配信には、Bun の `ws.subscribe("review")` と `server.publish("review", ...)` を使う
- メッセージは JSON で、`type` フィールドで種類を分ける

### クライアント → サーバー

| `type` | 内容 |
|--------|------|
| `hello` | 接続直後に送る。Nickname と `client_id` |
| `view` | 今開いているファイルのパス (何も開いていなければ `null`)。プレゼンスに使う |

### サーバー → クライアント

| `type` | いつ | 内容 |
|--------|------|------|
| `presence.changed` | 接続・切断・`view` の変更 | 参加者 (Nickname、`client_id`、開いているファイル) の一覧 |
| `thread.created` / `thread.updated` / `thread.deleted` | スレッドの作成・コメントの追加 / 編集 / 削除・Resolve / Reopen・再アンカー・送信済みの記録・スレッドの削除 | スレッド (コメントを含む) か、その ID。コメントの変更もスレッド全体で送る (REST の応答と同じ形にして、クライアントの処理を 1 種類にするため) |
| `file.changed` | 一覧に含まれるファイルの変更 | パス |
| `tree.changed` | ファイルの追加・削除 | — (クライアントは `GET /api/tree` で取り直す) |
| `session.ended` | セッションの終了 | — (クライアントは read-only のバナーを出す) |

### 再接続

- 切れたら指数的に間隔を延ばして (最大 10 秒) 再接続する
- 再接続したら `hello` を送り直し、`GET /api/threads` と `GET /api/tree` で取り直して整合させる (切れている間のイベントは再送しない)
- 切れるたびに `GET /api/session` を確かめ、`401` なら (サーバーが再起動して Cookie が無効になった) ログインの画面に戻る
