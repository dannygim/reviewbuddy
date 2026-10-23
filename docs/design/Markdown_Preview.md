# Markdown Preview

**目的: Markdown を Preview 表示しながら、元ファイルの行範囲にひも付けてコメントできるようにするための、レンダリング・行マッピング・Mermaid・サニタイズの仕様を定める。**

- 対応する調査: [レンダリング_調査.md](../research/レンダリング_調査.md)
- 対象の要件: F6 / F7 / F9 (Preview 表示でのブロックコメント) ([要件.md](./要件.md))

***

## レンダリング

- サーバー側で markdown-it 15 を使って HTML にする
- 有効にする記法: 表・取り消し線 (markdown-it の標準)、`linkify` (URL の自動リンク)、`html: true` (生の HTML。クライアントでサニタイズする)、タスクリスト (`- [ ]` / `- [x]` を無効化したチェックボックスにする小さな自前ルール)
- コードフェンスは、言語の指定があれば Shiki でハイライトする (コードの表示と同じ設定。[ファイル一覧と表示.md](./ファイル一覧と表示.md))。言語が `mermaid` のものは除く
- `Preview | Source` のタブで表示を切り替える。どちらで作ったスレッドも同じ行範囲で保存されるため、両方の表示に出る

***

## 行マッピング

Preview 上のコメントの肝。各ブロック要素に、元ファイルの行範囲を属性で付ける。

1. markdown-it でトークン化すると、ブロックトークンに `map = [開始行, 終了行)` (0 始まり・終了行は含まない) が付く
2. レンダラーを拡張し、次のトークンが作る要素に `data-src-start` / `data-src-end` (1 始まり・両端を含む) を付ける

   `heading_open` / `paragraph_open` / `list_item_open` / `tr_open` / `blockquote_open` / `fence` / `code_block` / `hr`

3. 末尾の空行は範囲から除く (リストなどは後続の空行まで `map` に含まれるため)
4. クライアントは、ホバーした位置から最も内側の `data-src-*` を持つ要素を選び、その行範囲でスレッドを作る
5. 表はヘッダー行と各データ行に個別にコメントできる (区切り行はどの行にも属さない)。Mermaid やコードブロックはフェンス全体 (フェンス記号の行を含む) が対象
6. スレッドの `anchor_text` は常に**元ファイルの該当行**から切り出す (Preview の表示テキストではない)。Agent にはソースがそのまま渡る

生の HTML のブロック (`html_block`) には属性を付けない。`<details>` のように Markdown をはさんで複数のブロックにまたがる HTML を包むと、構造が壊れるため。中の Markdown のブロックには属性が付き、HTML そのものへのコメントは Source 表示で行う。

***

## Mermaid

- 言語 `mermaid` のフェンスを `<div class="mermaid" data-src-start data-src-end>` (中身はエスケープしたソース) に変換する
- クライアントは、`.mermaid` を含むファイルを開いたときだけ Mermaid を動的 import して描画する (`securityLevel: 'strict'`、テーマは `prefers-color-scheme` に合わせる)
- 描画に失敗したら、ソースをそのまま `<pre>` で出し、エラーを添える
- v12 の既定値の変更と、`securityLevel: 'strict'` の扱いは、組み込む前に確認する ([レンダリング_調査.md](../research/レンダリング_調査.md) の要検証項目)

***

## サニタイズ

- クライアントで、サーバーから受け取った HTML を DOMPurify 3 でサニタイズしてから DOM に入れる
- `data-*` 属性は残す (DOMPurify の既定 `ALLOW_DATA_ATTR: true`)。Shiki が出す `style` 属性 (CSS 変数) も残す
- `<script>`、イベントハンドラー属性、`javascript:` の URL は落とす
- 相対リンク (`./other.md`) は、ルート内のファイルなら `#/doc/<path>` に書き換えてアプリ内で開く。外部リンクは `target="_blank" rel="noopener noreferrer"` にする

***

## テスト観点

- [レンダリング_調査.md](../research/レンダリング_調査.md) の 20 行のサンプルで、期待どおりの `data-src-start` / `data-src-end` が付く (見出し `1-1`、段落 `3-4`、リスト項目 `6-6` / `7-8` / `8-8`、表のヘッダー `10-10`、データ行 `12-12` / `13-13`、Mermaid `15-18`、引用 `20-20`)
- リストの末尾の空行が範囲に含まれない
- タスクリスト、表、取り消し線、自動リンクが描画される
- 言語付きのコードフェンスがハイライトされ、`mermaid` は `.mermaid` の要素になる
- `<script>` や `javascript:` の href を含む Markdown を開いても実行されない (E2E)
- Mermaid を含まないファイルを開いたとき、Mermaid のチャンクを読み込まない (E2E)
