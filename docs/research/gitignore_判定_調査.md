# gitignore 判定 調査

**目的: File Tree に出すファイルを Git と同じ基準で選ぶために、`git ls-files` の挙動と、Git 管理外のディレクトリ向けの代替手段を確認日付きで記録する。**

***

## 前提

- 調査日: 2026-10-23 (ignored ファイルの一覧は 2026-11-17 に追記)
- 凡例: **確認済** = 公式ドキュメントか、手元で実行して確認したもの / **要検証** = 二次ソースや推測
- 前提となる要件: `.gitignore` の対象は File Tree に出さない ([要件.md](../design/要件.md) の F4)。ただし Owner には ignored ファイルも出す (A6)

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

### ignored ファイルの一覧: `git ls-files --others --ignored --exclude-standard --directory --no-empty-directory -z`

上と同じ種類のサンプルリポジトリ (`dist/`・`node_modules/`・`build/` を除外し、`build/keep.txt` だけ `git add -f`) で実行して確認した **確認済** (2026-11-17、Git 2.56.1、macOS)。

| ケース | 結果 |
|--------|------|
| 中がすべて未追跡で除外されたディレクトリ (`dist/`、`node_modules/`) | `dist/` のように末尾に `/` を付けた 1 行に畳まれる。中のファイルは出ない |
| 除外されたディレクトリだが、中に追跡済みのファイルがある (`build/keep.txt` を `git add -f`) | 畳まれず、除外されたファイルが 1 つずつ出る (`build/other.txt`)。追跡済みの `build/keep.txt` は出ない |
| 追跡済みの `tracked.log` (`*.log` に該当) | 出ない (通常の一覧の側に出る) |
| `.env`、`app.log`、サブディレクトリの `.gitignore` の `sub/secret.txt`、`.git/info/exclude` の `localonly.txt` | 1 つずつ出る |
| 除外された空のディレクトリ (`build2/`) | `--directory` だけだと `build2/` が出る。`--no-empty-directory` を付けると出ない |
| `git -C sub ...` | `sub` からの相対パスで出る |
| `--no-optional-locks` を付けて実行 | `.git/index` の mtime は変わらない |

- `--directory` を付けないと、除外されたディレクトリの中のファイルがすべて出る。このリポジトリでは 14,557 件 (ほとんどが `node_modules/`)、`--directory` を付けると 4 行 (`.agents/`、`.claude/`、`dist/`、`node_modules/`) になった **確認済** (実行。どちらも 0.1 秒程度)
- Git は、除外されたディレクトリの中のファイルを除外の否定 (`!`) で戻せない。そのため、畳まれたディレクトリの中のファイルはすべて除外されている **確認済** ([gitignore のドキュメント](https://git-scm.com/docs/gitignore) の「It is not possible to re-include a file if a parent directory of that file is excluded.」)

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
- **ignored ファイルは `--ignored --directory` で畳んだ形で取れる**。`node_modules/` のような大きなディレクトリも 1 行になるため、中身は開いたときに 1 階層ずつ読めばよい (中はすべて除外されているので、Git に聞き直す必要がない)

***

## 出典

> 出典: [Git — gitignore](https://git-scm.com/docs/gitignore) (確認日: 2026-11-17)

> 出典: [Git — git-ls-files](https://git-scm.com/docs/git-ls-files) (確認日: 2026-11-17)
