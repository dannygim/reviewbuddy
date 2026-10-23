# Architecture

**目的: accepted の ADR を反映した、akapen の現在のアーキテクチャの索引。詳細は `design/` と `adr/` を参照する。**

***

## 概要

akapen は Bun の単一バイナリで動く CLI である。起動すると、1 つのプロセスが HTTP / WebSocket のサーバーとして React の SPA と API を配信し、ルート (対象ディレクトリ) を読み取り専用で扱う。コメントは `~/.config/akapen/` にセッション単位の SQLite で保存する。全体像は [全体設計.md](./design/全体設計.md) を参照する。

***

## 決定事項の索引

| 領域 | 現在の決定 | ADR | 設計書 |
|------|-----------|-----|--------|
| ランタイムと配布の形 | Bun 1.4 の `Bun.serve` で SPA と API を 1 プロセスにまとめ、`bun build --compile` で単一バイナリにする | [ADR-0001](./adr/0001-bun-single-binary.md) | [全体設計.md](./design/全体設計.md) |
| Markdown のレンダリング | markdown-it の `map` から各ブロックに元ファイルの行範囲を付ける | [ADR-0002](./adr/0002-markdown-it.md) | [Markdown_Preview.md](./design/Markdown_Preview.md) |
| 保存先とセッション | `~/.config/akapen/sessions/<id>/` にセッションごとの `session.json` と SQLite | [ADR-0003](./adr/0003-session-storage.md) | [保存先とセッション.md](./design/保存先とセッション.md) / [データモデル.md](./design/データモデル.md) |
| ファイル一覧の除外判定 | `git ls-files` に任せ、Git 管理外だけ `ignore` で判定する | [ADR-0004](./adr/0004-git-ls-files.md) | [ファイル一覧と表示.md](./design/ファイル一覧と表示.md) |
| 配布 | GitHub Releases + mise の `github:` バックエンド | [ADR-0005](./adr/0005-distribution-mise-github.md) | [配布.md](./design/配布.md) |
| セキュリティ | 起動ごとの 6 桁の PIN と Cookie で閲覧を制限。加えて `Host` の許可リスト + 書き込みと WebSocket のトークン + WebSocket の `Origin` 検証 | [ADR-0007](./adr/0007-access-pin.md) (ADR-0006 を置き換え) | [セキュリティ.md](./design/セキュリティ.md) |

***

## 設計書の一覧

| 設計書 | 内容 |
|--------|------|
| [要件.md](./design/要件.md) | 機能要件 (F1〜F13)・追加機能 (A1〜A4)・非機能要件・スコープ外 |
| [全体設計.md](./design/全体設計.md) | プロセス構成、技術選定、主な処理の流れ、ソースの構成、横断方針 |
| [ファイル一覧と表示.md](./design/ファイル一覧と表示.md) | FileIndex、ツリー順、ファイルの種類と表示、ファイルの監視 |
| [Markdown_Preview.md](./design/Markdown_Preview.md) | markdown-it のレンダリング、行マッピング、Mermaid、サニタイズ |
| [API.md](./design/API.md) | REST API と WebSocket のイベント |
| [セキュリティ.md](./design/セキュリティ.md) | 想定する脅威と対策 |
| [保存先とセッション.md](./design/保存先とセッション.md) | ディレクトリ構成、セッションのライフサイクル、削除ポリシー |
| [データモデル.md](./design/データモデル.md) | `review.db` のスキーマ、再アンカー |
| [プロンプト出力仕様.md](./design/プロンプト出力仕様.md) | プロンプトの形式、コピー、`akapen export` |
| [CLI_仕様.md](./design/CLI_仕様.md) | コマンド、オプション、環境変数、終了コード |
| [設定ファイル.md](./design/設定ファイル.md) | `config.toml` の優先順位とキー |
| [画面構成.md](./design/画面構成.md) | レイアウトと操作 |
| [配布.md](./design/配布.md) | 配布の方式、CI とリリース、利用側の設定 |
