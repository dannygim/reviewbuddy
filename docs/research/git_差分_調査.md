# git 差分 調査

**目的: 未コミットの変更 (HEAD と作業ツリーの差) を、対象ディレクトリに書き込まずに git から取り出す方法を、手元での実測と公式ドキュメントで確かめる。**

***

## 用語

| 用語 | 意味 |
|------|------|
| porcelain | 人が使う git のコマンド (`git diff`、`git status` など)。設定 (`diff.*`) を読み、ついでの処理 (index の更新) をする |
| plumbing | スクリプト向けの git のコマンド (`git diff-index`、`git cat-file` など)。出力の形が安定していて、UI の設定を読まない |
| stat-dirty | 中身は index と同じだが、mtime などの stat 情報が index と違うファイル (`touch` しただけなど) |

***

## 前提

- 調査日: 2026-11-05
- 検証環境: macOS (Apple silicon)、git 2.56.0
- 凡例: 確認済 = 手元で実行して確かめた / 文書 = 公式ドキュメントの記述

***

## 仕様サマリー

### index への書き込み

`touch` で stat-dirty にしたファイルがあるリポジトリで各コマンドを実行し、`.git/index` の mtime が変わるかを見た。

| コマンド | `.git/index` | 確度 |
|----------|--------------|------|
| `git diff HEAD` | 書き換える | 確認済 |
| `git --no-optional-locks diff HEAD` | 書き換える | 確認済 |
| `git diff` (作業ツリーと index) | 書き換える | 確認済 |
| `git status --porcelain` | 書き換える | 確認済 |
| `git --no-optional-locks status --porcelain` | 書き換えない | 確認済 |
| `git --no-optional-locks diff-index HEAD ...` | 書き換えない | 確認済 |
| `git ls-files ...` / `git cat-file blob ...` | 書き換えない | 確認済 |

- `--no-optional-locks` は「ロックが要る任意の処理をしない」(`GIT_OPTIONAL_LOCKS=0` と同じ) とだけ書かれ、どのコマンドに効くかは書かれていない (文書)。`git diff` には効かなかった (確認済)

### `git diff-index HEAD` (non-cached モード)

- HEAD と「index の内容と、index と同期していない作業ツリーのファイル」の差を出す (文書)
- 中身は読まずに stat で判断するので、stat-dirty のファイルも変更として出す (文書)。`--name-status` では stat-dirty のファイルが `M` で出る (確認済)
- `--numstat` は中身を比べるので、stat-dirty なだけのファイルは出さない (確認済)。バイナリは追加・削除の行数の代わりに `-` `-` を出す (文書)
- `--numstat -z` の 1 件は `<追加>\t<削除>\t<パス>\0`。名前の変更 (`-M`) は `<追加>\t<削除>\t\0<元のパス>\0<新しいパス>\0` (文書・確認済)
- `--name-status -z` の 1 件は `<状態>\0<パス>\0`。名前の変更は `R<類似度>\0<元のパス>\0<新しいパス>\0` (確認済)
- `-p -U0` の hunk のヘッダーは `@@ -<旧の開始>[,<行数>] +<新の開始>[,<行数>] @@ <関数名>`。行数が 1 なら省く。行数が 0 のときの開始は、その直前の行 (確認済: `@@ -3,0 +4 @@`)
- 未追跡のファイルは出さない。`git ls-files --others --exclude-standard` で別に取る (確認済)

### ルートがリポジトリのサブディレクトリのとき

| コマンド | 出力のパス | 確度 |
|----------|-----------|------|
| `git diff-index HEAD --name-status` | リポジトリのトップからの相対パス。サブディレクトリの外の変更も出る | 確認済 |
| `git diff-index HEAD --relative --name-status` | サブディレクトリからの相対パス。外の変更は出ない | 確認済 |
| `git ls-files --others` | カレントディレクトリからの相対パス | 確認済 |
| `git cat-file blob HEAD:./<path>` | `./` で始まるパスはカレントディレクトリからの相対 (文書・確認済) | 確認済 |

### HEAD が無いリポジトリ (最初のコミットの前)

- `git rev-parse --verify -q HEAD` が終了コード 1 を返す (確認済)
- `git diff HEAD` は `fatal: ambiguous argument 'HEAD'` で失敗する (確認済)

***

## 重要な気づき

- **porcelain の `git diff` は使えない**。`--no-optional-locks` を付けても `.git/index` を書き換えるため、「対象ディレクトリに書き込まない」に反する。plumbing の `git diff-index` を使う
- **変更のあるファイルの一覧は `--numstat` から作る**。`--name-status` だけだと、`touch` されただけのファイルが変更として混ざる。状態 (追加・削除・名前の変更) は `--name-status` で補う
- **ルートがサブディレクトリでも、`--relative` と `HEAD:./<path>` でルートからの相対パスにそろう**
- plumbing は `diff.algorithm` などの UI の設定を読まないので、利用者の git の設定で出力の形が変わらない

***

## 出典

> 出典: [git - --no-optional-locks](https://git-scm.com/docs/git) (確認日: 2026-11-05)

> 出典: [git-diff-index](https://git-scm.com/docs/git-diff-index) (確認日: 2026-11-05)

> 出典: [gitrevisions - <rev>:<path>](https://git-scm.com/docs/gitrevisions) (確認日: 2026-11-05)
