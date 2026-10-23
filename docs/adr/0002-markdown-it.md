# 0002. Markdown のレンダリングに markdown-it を使う

- status: accepted
- date: 2026-10-23

## Context

Markdown を Preview 表示したまま、元ファイルの行範囲にひも付くコメントを付けたい ([要件.md](../design/要件.md) の F6 / F9)。そのためには、レンダリングした各ブロックが元ファイルの何行目から何行目に当たるかが要る。Bun には組み込みの `Bun.markdown` があり、依存を増やさずに済む。

調査: [レンダリング_調査.md](../research/レンダリング_調査.md) / [Bun_調査.md](../research/Bun_調査.md)

## Decision

**サーバー側のレンダリングに markdown-it 15 を使い、ブロックトークンの `map` から各要素に `data-src-start` / `data-src-end` を付ける。`Bun.markdown` は使わない。**

## Options considered

- **markdown-it 15** (採用): ブロックトークンに `map` (行範囲) が付き、レンダラーの差し替えが容易 — 依存が 1 つ増える。タスクリストは小さな自前ルールが要る
- **Bun.markdown**: 組み込みで速い — ソース位置を返さない。サニタイズもしない。ドキュメント上まだ開発中
- **remark (unified)**: 全ノードに位置情報がある — mdast → hast → HTML の多段で依存が多い
- **marked**: 依存が小さい — 行番号が取れない

## Consequences

- 行範囲の変換 (0 始まり・終了を含まない → 1 始まり・両端を含む、末尾の空行の除去) をレンダラーの中に閉じ込める ([Markdown_Preview.md](../design/Markdown_Preview.md))
- 生の HTML はサーバーではサニタイズしないため、クライアントで DOMPurify を通す
- `Bun.markdown` にソース位置の情報が追加されたら、置き換えを再検討する
