# mise での配布 調査

**目的: akapen の単一バイナリを mise で入れられるようにするために、mise のバックエンド・registry の登録条件・private リポジトリでの利用条件を確認日付きで記録する。**

***

## 前提

- 調査日: 2026-10-23
- 凡例: **確認済** = 公式ドキュメントか、手元で実行して確認したもの / **要検証** = 未確認のもの
- 検証環境: mise 2026.10.17

***

## 仕様サマリー

### mise のバックエンド (2026.10.17)

`mise backends` の一覧: `aqua` / `asdf` / `cargo` / `conda` / `core` / `dotnet` / `forgejo` / `gem` / `github` / `gitlab` / `go` / `npm` / `packslip` / `pypi` / `spinel` / `spm` / `http` / `s3` / `ubi` / `vfox` **確認済** (実行)

| バックエンド | 要点 | 確度 |
|-------------|------|------|
| `github:` | `mise use github:owner/repo`。Release のアセットを OS・CPU・libc・アーカイブ形式・「リポジトリ名で始まるか」で採点して自動で選ぶ (デバッグ版・checksum・署名ファイルは減点、同点なら短い名前)。`asset_pattern` / `bin` / `bin_path` / `version_prefix` / `platforms.<os>-<arch>` で上書きできる。公開リポジトリならトークン不要 | 確認済 |
| `github:` の検証 | GitHub が返すアセットのダイジェストか、同じ Release の checksum ファイルを確認する。公開 GitHub では artifact attestation があれば検証する。SLSA は `slsa_signer_identity` と `slsa_signer_issuer` を指定したときのみ | 確認済 |
| `packslip:` | Release に署名付きマニフェスト `packslip.sigstore.json` を置く方式。mise に組み込み。GitHub Actions では `jdx/packslip@v1` が OIDC でキーレス署名する (Ed25519 鍵でも可)。man ページ・シェル補完・agent skill の同梱も宣言できる。semver (`2026.9.1` のような日付版も可) が必須。作者は mise の jdx と aqua の suzuki-shunsuke | 確認済 |
| `npm:` | mise 組み込みのパッケージマネージャー (aube) で入れる。`npm.package_manager = "bun"` で Bun を使える (Bun の PATH が必要)。実行時のランタイム (Node / Bun) は自分で `[tools]` に入れる必要がある | 確認済 |
| `http:` | URL を Tera テンプレート (`{{ version }}` / `{{ os() }}` / `{{ arch() }}`) で書く。`platforms.<os>-<arch>` で個別指定、`checksum` / `checksum_url`。`latest` や `ls-remote` には `version_list_url` が必要 | 確認済 |
| `aqua:` | aqua registry のレシピに従って入れる。checksum / attestation / Cosign / SLSA / Minisign の検証を mise 自身が実装している | 確認済 |
| `ubi:` | 非推奨。mise 2027.1.0 で削除予定 | 確認済 |

### mise registry (`mise use <短縮名>`) の登録条件

- 「新しい短縮名は広く使われているツール向け。通常は数千の GitHub スター、継続的なメンテナンス、作者以外のプロジェクトでの実利用」。動くだけでは不十分で、多くの提案は却下される **確認済**
- バックエンドの受け入れ段階: Tier 1 = `packslip` (署名マニフェストを公開している場合) / Tier 2 = `aqua` / `github` / `gitlab` / Tier 3 = `conda` / Tier 4 = `npm` / `pypi` / `gem` / `cargo` / `go` / `dotnet` (事前に jdx の合意が必要) / 受け付けない = `asdf` / `vfox` / `ubi` **確認済**
- 形式: `registry/<name>.toml` に 1 ツール 1 ファイル。`backends` と `version_order` が必須。新規は `test = { cmd = "akapen --version", expected = "{{version}}" }` も必須 (CI の `mise test-tool` で検証する) **確認済**

### private リポジトリでの利用

- トークンの探索順 (最初に見つかったものだけを使う): `MISE_GITHUB_ENTERPRISE_TOKEN` (github.com 以外のホスト) → `MISE_GITHUB_TOKEN` → `GITHUB_API_TOKEN` → `GITHUB_TOKEN` → `github.credential_command` (例: `gh auth token --hostname "$MISE_CREDENTIAL_HOST"`) → ネイティブ OAuth → `github_tokens.toml` → gh の `hosts.yml` (gh は実行しない) → `git credential fill` (`use_git_credentials` が有効なときのみ)。`GH_TOKEN` は読まない **確認済**
- 権限: fine-grained PAT で Release のアセットを落とすには Contents: read が必要 **確認済**
- `mise token github` は、使われるトークンの出どころをマスク付きで表示する (トークンの供給源ではない) **確認済**
- gh がトークンを macOS のキーチェーンに保存している場合 (`gh auth status` に `(keyring)` と出る)、gh の `hosts.yml` にトークンは無く、mise は gh の認証を使えない (`mise token github` が `(none)`)。`github.credential_command` に `gh auth token --hostname "$MISE_CREDENTIAL_HOST"` を設定すると使える (`source: credential_command`) **確認済** (2026-10-23 に実行)
- mise はダウンロードしたアセットの GitHub artifact attestation を API で確かめる。GitHub Actions のワークフローのトークンで入れる場合は、`attestations: read` の権限が無いと 403 で失敗する。権限を付ければ、attestation の無い private リポジトリの Release でも入る **確認済** (v0.1.0 のスモークテストで実行)
- GitHub Actions では、別のリポジトリの private なツールを入れるのに GitHub App のトークンか PAT が必要 **確認済**
- `mise lock` は API 呼び出しを減らすが、private な成果物を公開するものではない **確認済**

### 公開直後のリリース (`minimum_release_age`)

- mise 2026.10 の `minimum_release_age` は既定で `24h`。公開から 24 時間たっていない版は、`latest` や `0.1` のような範囲の指定を解決するときに飛ばされる。`mise upgrade` は「no versions found ... matching minimum_release_age (24h)」と警告して何もしない **確認済** (2026-10-23、mise 2026.10.17。v0.1.1 の公開直後に発生)
- `@0.1.1` のように版を明示した場合は対象外 (リリースのスモークテストが通ったのはこのため) **確認済**
- その場で上げるには `mise upgrade <tool> --minimum-release-age 0s`、特定のツールを外すには `minimum_release_age_excludes` に完全なバックエンド ID (`github:dannygim/akapen`) を足す (`mise settings add minimum_release_age_excludes github:dannygim/akapen`) **確認済** (前者は実行、後者はドキュメント)
- GitHub の artifact attestation は、Free / Pro / Team では public リポジトリのみ。private / internal は GitHub Enterprise Cloud が必要 **確認済** (GitHub Docs)

### 未確認の事項

- アセット名 `akapen-v0.1.0-darwin-arm64.tar.gz` / `-linux-x64.tar.gz` で、mise の自動判定が正しく選ぶか → **確認済** (v0.1.0 で、macOS は `darwin-arm64`、Linux は `linux-x64` を選んだ)
- mise (HTTP クライアント) でダウンロードしたバイナリに quarantine 属性が付かず、Gatekeeper の警告が出ないか → **確認済** (v0.1.0。`com.apple.quarantine` は付かず、ad-hoc 署名のまま実行できる)
- packslip の GitHub Action に必要な `permissions` (`id-token: write` など) **要検証**
- aqua registry への新規追加の条件と手順 **要検証**

***

## 重要な気づき

- **`mise use akapen` の短縮名は当面狙えない**。登録条件が「数千スター級」のため、`github:<owner>/akapen` の完全名で配る
- **`github:` バックエンドなら、Release に OS / arch 別のアーカイブを置くだけで入る**。利用者側に Bun は要らない
- **private のままでも自分は使える**。gh で `gh auth login` 済みなら、mise は gh の `hosts.yml` を読む。ただし期限切れの `GITHUB_TOKEN` などが環境変数に残っていると、先にそちらが使われて失敗する
- **private の間は artifact attestation を付けられない** (GitHub Enterprise Cloud が必要)。checksum の検証は効く
- **packslip を足すと registry の Tier 1 になる**が、private で動くかは未確認。public にしてから導入する
- **新しいリリースは、利用者の `mise upgrade` には 24 時間後に出てくる** (mise の `minimum_release_age` の既定値)。急ぐときの手順を README に書く

***

## 出典

> 出典: [mise — GitHub backend](https://mise.jdx.dev/dev-tools/backends/github.html) (確認日: 2026-10-23)

> 出典: [mise — packslip backend](https://mise.jdx.dev/dev-tools/backends/packslip.html) (確認日: 2026-10-23)

> 出典: [mise — npm backend](https://mise.jdx.dev/dev-tools/backends/npm.html) (確認日: 2026-10-23)

> 出典: [mise — http backend](https://mise.jdx.dev/dev-tools/backends/http.html) (確認日: 2026-10-23)

> 出典: [mise — aqua backend](https://mise.jdx.dev/dev-tools/backends/aqua) (確認日: 2026-10-23)

> 出典: [mise — Registry](https://mise.jdx.dev/registry.html) (確認日: 2026-10-23)

> 出典: [mise — Adding a tool to the registry](https://mise.jdx.dev/contributing/registry.html) (確認日: 2026-10-23)

> 出典: [packslip](https://packslip.dev) (確認日: 2026-10-23)

> 出典: [mise — GitHub tokens](https://mise.jdx.dev/dev-tools/github-tokens.html) (確認日: 2026-10-23)

> 出典: [mise — Settings: minimum_release_age / minimum_release_age_excludes](https://mise.jdx.dev/configuration/settings.html#minimum_release_age) (確認日: 2026-10-23)

> 出典: [GitHub Docs — Using artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) (確認日: 2026-10-23)
