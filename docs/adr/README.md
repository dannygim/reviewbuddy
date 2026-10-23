# Architecture Decision Records

このディレクトリには Architecture Decision Records (ADR) を置く。

## Format

ADR は 1 決定 1 ファイルの Markdown で書く。メタデータは YAML frontmatter ではなく本文冒頭のリストに書く。テンプレート:

```markdown
# NNNN. 決定内容を表す短いタイトル

- status: proposed        # proposed | accepted | superseded | retired
- date: YYYY-MM-DD
- superseded_by: "NNNN"  # status: superseded のときのみ

## Context
この決定が必要になった状況。どのような要因・制約があるか。

## Decision
**何を決めたか。** 1〜2 文で明確に書き、目立つように太字にする。

## Options considered
- **案 A** (採用): 概要 — 長所 / 短所
- **案 B**: 概要 — 長所 / 短所
- **案 C**: 概要 — 長所 / 短所

## Consequences
この決定で何が容易になり、何が難しくなるか。
良い影響と悪い影響。
どのような状況になったら決定を見直すか。

## Advice
*(任意)* 決定前に受けた意見。誰にいつ相談し、何を言われたか。
外部の意見を受けずに決めた場合は省略する。
```

### Status lifecycle

```text
proposed → accepted → superseded
                 ↘ retired      (決定が不要になり、置き換えもない)
```

## Rules

- 1 ファイル 1 決定
- ファイル名は `NNNN-short-title.md` (4 桁の連番。番号は再利用しない)
- `accepted` になった ADR の本文は編集しない。変更してよいのは status のみ (superseded にするときの `superseded_by` の追記を含む)。決定を変えるときは新しい ADR を起票して置き換える
- 置き換えられた旧 ADR は `status: superseded` に変更し、`superseded_by: "NNNN"` を追記する (新 ADR 側には書かない)
- [ARCHITECTURE.md](../ARCHITECTURE.md) は現在の状態 (accepted の決定のみ) を反映する

## Index

| ID | Title | Status |
|----|-------|--------|
