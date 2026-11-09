# git 差分 調査

**目的: 未コミットの変更 (HEAD と作業ツリーの差) と、ブランチとの差 (ブランチとの分岐点と作業ツリーの差) を、対象ディレクトリに書き込まずに git から取り出す方法を、手元での実測と公式ドキュメントで確かめる。**

***

## 用語

| 用語 | 意味 |
|------|------|
| porcelain | 人が使う git のコマンド (`git diff`、`git status` など)。設定 (`diff.*`) を読み、ついでの処理 (index の更新) をする |
| plumbing | スクリプト向けの git のコマンド (`git diff-index`、`git cat-file` など)。出力の形が安定していて、UI の設定を読まない |
| stat-dirty | 中身は index と同じだが、mtime などの stat 情報が index と違うファイル (`touch` しただけなど) |
| merge base | 2 つのコミットの両方から親をたどって届く共通の祖先のうち、最も新しいもの。ブランチが分かれた点 |
| symref | 他の ref を指す ref。`refs/remotes/origin/HEAD` (リモートの既定のブランチを指す) など |

***

## 前提

- 調査日: 2026-11-05 (ブランチとの比較は 2026-11-08)
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

### ブランチとの比較

`main` から分かれて 1 コミット進めた `feature` で、stat-dirty のファイル (`touch`) を置いて実行した。

| コマンド | 結果 | 確度 |
|----------|------|------|
| `git --no-optional-locks for-each-ref --format=<形式> refs/heads refs/remotes` | ローカルとリモート追跡のブランチを refname の順に出す。`.git/index` は書き換えない | 確認済 |
| `--format` の `%00` | NUL を出す (フィールドの区切りに使える) | 文書・確認済 |
| `%(refname:short)` | 曖昧でない短い名前 (`refs/heads/main` → `main`、`refs/remotes/origin/main` → `origin/main`)。`refs/remotes/origin/HEAD` は `origin` | 文書・確認済 |
| `%(symref)` | symref なら指す先 (`refs/remotes/origin/HEAD` → `refs/remotes/origin/main`)。symref でなければ空 | 文書・確認済 |
| `%(HEAD)` | チェックアウトしているブランチなら `*`、それ以外は空白 | 文書・確認済 |
| `git --no-optional-locks merge-base <ref> HEAD` | 分岐点のコミットを 1 つ出す。`.git/index` は書き換えない | 確認済 |
| `merge-base` で共通の祖先が無い (`checkout --orphan` で作ったブランチ) | 何も出さず、終了コード 1 | 確認済 (文書には記述なし) |
| `merge-base` で merge base が複数ある (criss-cross merge) | `--all` が無ければ、どれを出すかは決まっていない | 文書 |
| `git --no-optional-locks diff-index <merge base> -M --relative --numstat -z` | `HEAD` のときと同じ形で、分岐点と「index + 作業ツリー」の差を出す。ブランチのコミットの変更と未コミットの変更の両方が出る。stat-dirty なだけのファイルは出さず、`.git/index` は書き換えない | 確認済 |

### HEAD が無いリポジトリ (最初のコミットの前)

- `git rev-parse --verify -q HEAD` が終了コード 1 を返す (確認済)
- `git diff HEAD` は `fatal: ambiguous argument 'HEAD'` で失敗する (確認済)

***

## 重要な気づき

- **porcelain の `git diff` は使えない**。`--no-optional-locks` を付けても `.git/index` を書き換えるため、「対象ディレクトリに書き込まない」に反する。plumbing の `git diff-index` を使う
- **変更のあるファイルの一覧は `--numstat` から作る**。`--name-status` だけだと、`touch` されただけのファイルが変更として混ざる。状態 (追加・削除・名前の変更) は `--name-status` で補う
- **ルートがサブディレクトリでも、`--relative` と `HEAD:./<path>` でルートからの相対パスにそろう**
- plumbing は `diff.algorithm` などの UI の設定を読まないので、利用者の git の設定で出力の形が変わらない
- **ブランチとの差は、`HEAD` の代わりに `merge-base <ref> HEAD` のコミットを `diff-index` に渡せば取れる**。一覧・元の内容 (`cat-file blob <コミット>:./<path>`)・hunk の取り方は HEAD と同じでよい
- **ブランチの一覧から `origin/HEAD` のような symref を除くには `%(symref)` を見る**。短い名前 (`origin`) だけでは見分けられない

***

## 出典

> 出典: [git - --no-optional-locks](https://git-scm.com/docs/git) (確認日: 2026-11-05)

> 出典: [git-diff-index](https://git-scm.com/docs/git-diff-index) (確認日: 2026-11-05)

> 出典: [gitrevisions - <rev>:<path>](https://git-scm.com/docs/gitrevisions) (確認日: 2026-11-05)

> 出典: [git-for-each-ref](https://git-scm.com/docs/git-for-each-ref) (確認日: 2026-11-08)

> 出典: [git-merge-base](https://git-scm.com/docs/git-merge-base) (確認日: 2026-11-08)
