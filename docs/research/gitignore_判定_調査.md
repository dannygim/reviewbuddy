# gitignore 判定 調査

**目的: File Tree に出すファイルを Git と同じ基準で選ぶために、`git ls-files` の挙動と、Git 管理外のディレクトリ向けの代替手段を確認日付きで記録する。**

***

## 前提

- 調査日: 2026-10-23
- 凡例: **確認済** = 公式ドキュメントか、手元で実行して確認したもの / **要検証** = 二次ソースや推測
- 前提となる要件: `.gitignore` の対象は File Tree に出さない ([要件.md](../design/要件.md) の F4)

***

## 仕様サマリー

### `git ls-files --cached --others --exclude-standard -z`

ネストした `.gitignore` を含むサンプルリポジトリで実行して確認した **確認済** (Git、手元で実行)。

| ケース | 結果 |
|--------|------|
| ルートの `.gitignore` に `dist/` と `*.log` | `dist/out.js`・`app.log` は出ない |
| `*.log` に該当するが `git add -f` 済みの `tracked.log` | 出る (追跡済みを優先) |
| サブディレクトリの `.gitignore` に `secret.txt` | `sub/secret.txt` は出ない |
| `.git/info/exclude` に `localonly.txt` | 出ない |
| 未追跡で除外されていない `untracked.md` | 出る |
| index にあるが作業ツリーから削除した `gone.md` | **出る** → 存在チェックで除外が必要 (`git ls-files --deleted` で一覧化もできる) |
| `git -C sub ls-files ...` | `sub` からの相対パスで出る |

### Git 管理外のディレクトリ向けの代替

- `ignore` 7.0.13: `.gitignore` の仕様に沿ったマッチャー。Git 管理外のディレクトリでのフォールバックに使う。ネストした `.gitignore` の積み上げは自前で実装する **要検証**

### その他

- サブモジュールは gitlink として 1 エントリで出る **要検証**

***

## 重要な気づき

- **Git と完全に同じ判定を得る最短手段は `git ls-files` に任せること**。`.gitignore` / `.git/info/exclude` / `core.excludesFile` をすべて Git が解釈する
- **作業ツリーで削除済みのファイルも出力される**ため、存在チェックで除く必要がある
- **ルートがリポジトリのサブディレクトリでも、出力はルートからの相対パスになる**。パスの変換は要らない
- 上の 7 ケースは、そのまま FileIndex のテストケースに使える ([ファイル一覧と表示.md](../design/ファイル一覧と表示.md))
