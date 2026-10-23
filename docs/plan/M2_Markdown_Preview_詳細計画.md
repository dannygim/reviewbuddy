# M2 Markdown Preview 詳細計画

**目的: Markdown を Preview 表示し、各ブロックに元ファイルの行範囲を付け、Mermaid を図として描く。Preview と Source をタブで切り替えられるようにする。**

- 上位計画: [akapen_実装計画.md](./akapen_実装計画.md) の M2
- 設計: [Markdown_Preview.md](../design/Markdown_Preview.md) / [セキュリティ.md](../design/セキュリティ.md)
- 調査: [レンダリング_調査.md](../research/レンダリング_調査.md)
- 作成日: 2026-10-23
- 書き方: M1 と同じく、コードの全文は載せない

***

## 目的

- 対象の要件: F6 (Markdown の Preview) / F7 (Mermaid)。F9 の Preview 上のブロックコメントは M4 だが、そのための行範囲の属性をここで付ける
- 前提の確認 (2026-10-23 に試作で確認): Bun の HTML import は、開発モードでも `bun build --compile` でも、既定では動的 import を別のチャンクに分けない (Mermaid を含む 5.2MB の 1 ファイルになる)。`--compile --splitting` を付けると分割され、最初の読み込みは約 1KB、Mermaid は必要になったときに読み込まれる

## スコープ

- markdown-it によるサーバー側のレンダリング: 行範囲の属性、末尾の空行の除去、タスクリスト、`linkify`、生の HTML、言語付きのコードフェンスの Shiki によるハイライト、`mermaid` のフェンスの変換、`html_block` の包み込み
- リンクの書き換え: ルート内の Markdown などへの相対リンクは `#/doc/<path>`、外部リンクは新しいタブ、相対パスの画像は `/api/raw`
- `FileView` (`kind: "markdown"`) に `previewHtml` を足す
- クライアント: `Preview | Source` のタブ、DOMPurify によるサニタイズ、Mermaid の動的 import と描画 (ライト / ダークに追従、失敗時はソースを出す)、Markdown 用の CSS
- ビルドに `--splitting` を足し、ビルドしたバイナリで Mermaid の遅延読み込みを確かめる
- CI を `docs/` と Markdown だけの変更では動かさないようにする

## 非スコープ

- ブロックへのホバーとコメントの作成 → M4
- 見出しへのアンカー (ページ内リンク) → v1 では行わない。`#` だけのリンクはクリックしても何もしない

## 完了条件

- [ ] `bun run verify` が通り、CI (macOS / Linux) も通る
- [ ] 調査の 20 行のサンプルで、期待どおりの `data-src-start` / `data-src-end` が付く (単体テスト)
- [ ] Preview 表示で、見出し・表・タスクリスト・ハイライトされたコード・Mermaid の図が出る。`<script>` や `onerror` を含む Markdown を開いても実行されない (E2E)
- [ ] Source タブで行番号付きのソースが出る (E2E)
- [ ] ルート内の Markdown への相対リンクをクリックすると、そのファイルが開く (E2E)
- [ ] ビルドしたバイナリで、Mermaid を含まないファイルを開いても Mermaid のチャンクを読み込まず、含むファイルを開くと読み込む

***

## タスク分解

### Task 1: ハッシュの関数を共有に移す

- **Files**: `src/shared/doc-link.ts` (`docPathFromHash` / `hashForDocPath` を `src/web/router.ts` から移す)、`src/web/router.ts`、テストの移動
- サーバー側のリンクの書き換えでも `hashForDocPath` を使うため

### Task 2: Markdown のレンダラー

- **Files**: `src/render/markdown.ts` / `src/render/markdown.test.ts`。依存に `markdown-it@15.0.3`、開発用に `@types/markdown-it@14.2.0` を足す
- **Produces**:
  - `renderMarkdown(source: string, options: { path: string; isListed: (path: string) => boolean }): Promise<string>`
  - `fenceLanguage(info: string): string` — フェンスの言語名 (`ts` / `sh` / `yml` / `dockerfile` など) を Shiki の言語に変換する。不明なら `text`
- **実装の要点**:
  - core のルールで、対象のトークンに `data-src-start` / `data-src-end` を付ける (`map` は 0 始まり・終了を含まない。末尾の空行を除く)
  - フェンスのハイライトは非同期のため、`md.parse` の後にフェンスを先にハイライトして `token.meta` に入れ、`md.renderer.render` は同期で行う
  - `fence` / `code_block` / `html_block` はレンダラーを差し替えて属性を付ける。`mermaid` は `<div class="mermaid">` (中身はエスケープしたソース)
  - リンク: スキームの無い相対リンクを、ファイルのディレクトリから解決し、一覧にあれば `#/doc/<path>` に書き換える。`http(s):` / `mailto:` には `target="_blank" rel="noopener noreferrer"` を付ける。画像も同様に `/api/raw?path=` に書き換える
- **テストケース**: 調査のサンプルの行範囲 / タスクリスト (`[ ]` と `[x]`) / 表と取り消し線 / `linkify` / TS のフェンスがハイライトされる / `mermaid` のフェンスがエスケープされた `div.mermaid` になる / `html_block` が `div` に包まれる / 相対リンク・存在しないリンク・外部リンク・画像の書き換え / `fenceLanguage`

### Task 3: `FileView` への組み込み

- **Files**: `src/shared/api.ts` / `src/render/file-view.ts` / `src/server.ts` とテスト
- `kind: "markdown"` の `FileView` に `previewHtml` を足す。`renderFile` の `options` に `isListed` を足し、サーバーは FileIndex の `has` を渡す
- **テストケース**: `GET /api/file?path=README.md` に `previewHtml` が入る

### Task 4: クライアントの Preview

- **Files**: `src/web/Viewer.tsx` / `src/web/MarkdownPreview.tsx` / `src/web/mermaid.ts` / `src/web/styles.css` / `test/e2e/markdown.test.ts`。依存に `dompurify@3.4.17` / `mermaid@12.2.0` を足す
- `Preview | Source` のタブ (既定は Preview)。Preview は DOMPurify (`ADD_ATTR: ["target"]`) を通した HTML を出し、`.mermaid` があれば `import("./mermaid")` で読み込んで描画する (`securityLevel: "strict"`、テーマは `prefers-color-scheme` に合わせる)。描画に失敗した図は、ソースのまま `mermaid-error` のクラスを付ける
- `#` だけのリンクのクリックは無視する (ハッシュルーティングを壊さないため)
- **E2E**: 見出しに `data-src-start` が付く / 表・タスクリスト・ハイライト / `.mermaid svg` が出る / `<script>` と `onerror` が実行されない / Source タブ / 相対リンクで別のファイルが開く

### Task 5: ビルドの分割と CI

- **Files**: `package.json` (`build` に `--splitting`)、`test/build.test.ts`、`.github/workflows/ci.yml`、[配布.md](../design/配布.md) のビルドのコマンド
- ビルドしたバイナリを `Bun.WebView` で開き、Mermaid を含まない Markdown を開いたときと含むものを開いたときで、読み込まれたスクリプトのサイズの合計を比べる (含むものを開いたときだけ数 MB 増える)
- CI に `paths-ignore: ["docs/**", "**/*.md"]` を足す

***

## リスク

| # | リスク | 対応 |
|---|--------|------|
| R1 | 開発モード (`bun --hot`) では分割されず、毎回 5MB 超のバンドルになる | 開発時だけの問題として受け入れる。遅延読み込みはビルドしたバイナリでテストする |
| R2 | Mermaid 12 の既定値の変更で図の見た目が変わる | `securityLevel` とテーマだけを指定し、他は既定に任せる。見た目の問題が出たら設定を足す |
| R3 | DOMPurify が Shiki の `style` 属性や `data-*` を落とす | E2E でハイライトの色と `data-src-*` が残ることを確かめる |
| R4 | キャッシュした `previewHtml` のリンクが、ファイルの追加・削除を反映しない | ファイルが変わるまでは古いリンクのまま。M6 のファイル監視でキャッシュを捨てる |

***

## 計測結果

2026-10-23、macOS (Apple silicon)、Bun 1.4.4 でビルドしたバイナリを `Bun.WebView` で開いて測った。

| 項目 | 結果 |
|------|------|
| 初回に読み込む JS (Mermaid を含まない Markdown を開いたとき) | 458 KB (`--splitting` なしでは 5.7 MB) |
| Mermaid を含む Markdown を開いた後の JS の合計 | 2,631 KB |
| バイナリのサイズ | 105.7 MB (`--splitting` なしでは 101.0 MB) |

- `--splitting` を付けると、Shiki の `bundledLanguagesInfo` が持つ全言語の動的 import までチャンクとして埋め込まれ、112.5 MB になった。使う言語だけを静的なパスで import する形 (`LANGUAGE_MODULES`) に変えて 105.7 MB にした
- 残りの 4.7 MB の増加は、分割で増えたチャンクのぶん。初回の読み込みが 5.7 MB から 458 KB に減るため受け入れる

## 計画からの変更

- `html_block` には `data-src-*` を付けず、`div` でも包まない。`<details>` のように Markdown をはさんで複数のブロックにまたがる生の HTML の構造を壊さないため ([Markdown_Preview.md](../design/Markdown_Preview.md) も更新した)
