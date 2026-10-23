# 0004. File Tree の除外判定を git ls-files に任せる

- status: accepted
- date: 2026-10-23

## Context

File Tree には `.gitignore` の対象を出さない ([要件.md](../design/要件.md) の F4)。`.gitignore` はネストでき、`.git/info/exclude` や `core.excludesFile` も効き、`git add -f` で追跡済みのファイルは除外されない。これを自前で再現すると、Git と判定がずれやすい。

調査: [gitignore_判定_調査.md](../research/gitignore_判定_調査.md)

## Decision

**Git リポジトリの中では `git -C <root> ls-files --cached --others --exclude-standard -z` の結果を一覧の元にし、作業ツリーに存在しないものを除く。Git 管理外のディレクトリ (または `git` が無い環境) でだけ、`ignore` で `.gitignore` を積み上げて判定する。**

## Options considered

- **`git ls-files` + Git 管理外は `ignore`** (採用): Git と完全に同じ判定になる — `git` のプロセスを起動する。削除済みのファイルの除外が要る
- **常に `ignore` で自前判定**: Git に依存しない — `core.excludesFile` や追跡済みのファイルの扱いが Git とずれる
- **ルートの `.gitignore` だけを読む**: 簡単 — ネストした `.gitignore` を取りこぼす

## Consequences

- Git の挙動に任せられるため、判定のずれを考えなくてよい。テストは調査で確認した 7 ケースをそのまま使える
- 作業ツリーから削除したが index に残っているファイルを、存在チェックで除く必要がある
- Git 管理外のときの判定 (`ignore` での積み上げ) は自前の実装になり、Git とわずかにずれる可能性が残る
