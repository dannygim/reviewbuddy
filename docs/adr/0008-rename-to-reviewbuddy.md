# 0008. アプリ名を akapen から reviewbuddy に変える

- status: accepted
- date: 2026-10-23

## Context

アプリ名を akapen (赤ペン) として v0.2.0 まで出した。名前はコマンド・設定とデータの置き場所 (`~/.config/akapen/`)・環境変数 (`AKAPEN_*`)・HTTP のヘッダーと Cookie・ブラウザの `localStorage` のキー・リリースのアーカイブ名・mise のバックエンド ID (`github:dannygim/akapen`)・GitHub のリポジトリ名に使っていて、使う人が増えるほど変えにくくなる。

akapen は日本語の「赤ペン」を知らないと由来が伝わらない。UI は英語のみである ([要件.md](../design/要件.md))。

調査: [名前_調査.md](../research/名前_調査.md)

## Decision

**アプリ名を reviewbuddy に変える (v0.3.0)。** 名前を使うところはすべて変える。

- コマンド `reviewbuddy`、設定とデータ `~/.config/reviewbuddy/`、環境変数 `REVIEWBUDDY_HOME` / `REVIEWBUDDY_PORT` / `REVIEWBUDDY_HOST`
- 書き込みのヘッダー `X-Reviewbuddy-Token`、Cookie `reviewbuddy_auth_<ポート>`、`localStorage` のキー `reviewbuddy.*`
- リリースのアーカイブ `reviewbuddy-v<版>-<os>-<arch>.tar.gz`、GitHub のリポジトリ `dannygim/reviewbuddy`、mise の `github:dannygim/reviewbuddy`

既存の `~/.config/akapen/` のセッションとコメントは引き継がない (移す処理も案内も入れない)。ADR-0001〜0007 の本文の akapen は reviewbuddy と読み替える。

## Options considered

- **reviewbuddy に変える** (採用): review + buddy で、一緒にレビューする相棒という用途が英語のまま伝わる。npm と mise registry で空いている — 利用者は入れ直しが要り、ブラウザの Nickname も聞き直しになる
- **akapen のまま**: 何も変えなくてよい — 由来が日本語を知る人にしか伝わらない
- **名前を変え、`~/.config/akapen/` を初回の起動で移す**: 前のセッションを続けられる — 移す処理とテストが増える。v0.2.0 を出した当日で、引き継ぐデータがほとんど無い

## Consequences

- akapen を入れた人は、`mise unuse -g github:dannygim/akapen` で外して `github:dannygim/reviewbuddy` を入れ直す。v0.2.0 以前のアーカイブとバイナリの名前は akapen のまま
- `~/.config/akapen/` は新しい版からは見えない。要らなければ消す
- GitHub は古いリポジトリ名の URL を新しい名前へ転送する
- 完了した計画書 (`plan/`) と ADR-0001〜0007 は、当時の記録として akapen の名前のまま残す
