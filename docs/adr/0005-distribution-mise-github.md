# 0005. GitHub Releases と mise の github バックエンドで配る

- status: accepted
- date: 2026-10-23

## Context

akapen を自分と同僚の Mac に入れ、版をそろえて更新したい。開発環境は mise で管理している。mise registry の短縮名 (`mise use akapen`) は、数千スター級の人気が登録の条件になっている。

調査: [mise_配布_調査.md](../research/mise_配布_調査.md)

## Decision

**GitHub Releases に `akapen-v<version>-<os>-<arch>.tar.gz` (中身は単一バイナリ) と `checksums.txt` を置き、`mise use github:<owner>/akapen` で入れる。public にした後に packslip の署名マニフェストと artifact attestation を足す。**

詳細: [配布.md](../design/配布.md)

## Options considered

- **`github:` バックエンド** (採用): Release にアーカイブを置くだけで入る。利用側に Bun が要らない。private リポジトリでも gh の認証で入る — 1 バイナリが 100MB 前後
- **`packslip:` バックエンド**: 署名の検証が強く、registry の Tier 1 — 新しい仕組みで事例が少なく、private で動くか未確認 (第 2 段階で足す)
- **`npm:` バックエンド**: 数百 KB と軽い — 利用側に Bun のランタイムが要る
- **mise registry の短縮名**: 最も簡単 — 登録の条件を満たさない

## Consequences

- アセットの名前で mise の自動判定が正しく選ぶか、quarantine 属性で Gatekeeper の警告が出ないかを、最初のリリースで確かめる必要がある
- private の間は artifact attestation を付けられない (GitHub Enterprise Cloud が必要)。checksum の検証は効く
- 人気が出て registry の条件を満たしたら、短縮名の登録を再検討する
