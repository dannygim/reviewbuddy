# Display mode 調査

**目的: Display mode (Light / Dark / System の切り替え) の実現に使う CSS・HTML の機能と、Shiki・Mermaid の配色の挙動を確認日付きで記録する。**

***

## 用語

- **`color-scheme`**: 要素をどの配色 (light / dark) で描画できるかをブラウザに伝える CSS のプロパティ
- **`light-dark()`**: 有効な配色に応じて、2 つの色のどちらかを返す CSS の関数
- **Popover API**: `popover` 属性を付けた要素を最前面 (top layer) に出し、開閉をブラウザに管理させる HTML の仕組み
- **light dismiss**: ポップオーバーの外側のクリックや Esc キーで、ポップオーバーが閉じること

***

## 前提

- 調査日: 2026-10-26
- 凡例: **確認済** = 公式ドキュメント・ソース・手元の実行で確認したもの / **要検証** = 記載がなく未確認のもの
- 検証環境: macOS、Bun 1.4.4 の `Bun.WebView` (WebKit と Chrome。E2E と同じ)、Shiki 4.5.0、Mermaid 12.2.0、`@types/react` 19.3.0
- OS の配色と回線の遅さは、`Bun.WebView` の Chrome のバックエンドで `view.cdp()` から DevTools Protocol の `Emulation.setEmulatedMedia` (`prefers-color-scheme`) と `Network.emulateNetworkConditions` を送ってまねた。WebKit のバックエンドには同じ手段が無い
- reviewbuddy の配色は、v0.3.0 の時点では `prefers-color-scheme` で OS に追従するだけである。参照している箇所は CSS の変数、Shiki の上書き、Mermaid のテーマの 3 つ ([ファイル一覧と表示.md](../design/ファイル一覧と表示.md) / [Markdown_Preview.md](../design/Markdown_Preview.md))

***

## 仕様サマリー

### CSS

| 機能 | 仕様 | 確度 |
|------|------|------|
| `color-scheme` | `:root` に `light dark` を指定すると、ページがユーザーの配色の設定に従う。Baseline Widely available (2022 年 1 月から) | 確認済 (MDN) |
| `light-dark(<light>, <dark>)` | 使うには `color-scheme` に `light dark` が要る (ふつうは `:root` に指定する)。引数にカスタムプロパティを使える (`light-dark(var(--a), var(--b))`)。Baseline 2024 (Newly available、2024 年 5 月から) | 確認済 (MDN) |
| `color-scheme` の固定 | `:root` の `color-scheme` を `dark` に変えると、OS がライトのままでも `light-dark()` はダークの値を返す。`:root` に `light-dark()` で定義したカスタムプロパティも、要素の `style` 属性に直接書いた `light-dark()` も同じ。`light` に戻すとライトの値に戻る | 確認済 (実行。WebKit / Chrome) |
| 逆向きの固定 | OS がダークのときに `color-scheme: light` に固定すると、ライトの値を返す (`prefers-color-scheme: dark` をまねた状態で、属性なしは背景が `rgb(13, 17, 23)`、`light` に固定すると `rgb(255, 255, 255)`) | 確認済 (実行。Chrome) / WebKit は要検証 (OS の配色をまねる手段が無く、未実行) |

### HTML: Popover API

| 機能 | 仕様 | 確度 |
|------|------|------|
| `popover` 属性 | Baseline Widely available (2024 年 4 月から全ブラウザ) | 確認済 (MDN) |
| `popover="auto"` | 外側のクリック、Esc キー、別のポップオーバーを開いたときに閉じる (light dismiss)。auto のポップオーバーは、入れ子を除いて同時に 1 つだけ開く | 確認済 (MDN) |
| 開閉の操作 | ボタンに `popovertarget` で対象を指定すると、そのボタンで開閉する | 確認済 (MDN) |
| メニューのキーボード操作 | 矢印キーでの項目の移動の仕組みは、Popover API のページに記載がない。WAI-ARIA の menu パターンに沿って自前で実装する前提にする | 確認済 (MDN に記載なし) |
| React の型 | `@types/react` 19.3.0 に `popover` / `popoverTarget` / `popoverTargetAction` の型がある | 確認済 (型定義) |

### Shiki 4.5.0

`codeToTokens` に `themes: { light: "github-light", dark: "github-dark" }` を渡したときの、各トークンの `htmlStyle`。

| `defaultColor` | 出力 (TypeScript の `const`) | 確度 |
|------|------|------|
| 省略 (= `light`) | `{"color":"#D73A49","--shiki-dark":"#F97583"}` | 確認済 (実行) |
| `'light-dark()'` | `{"color":"light-dark(#D73A49, #F97583)","--shiki-light":"#D73A49","--shiki-dark":"#F97583"}` | 確認済 (実行) |

- `'light-dark()'` のとき、太字・斜体などは `font-style` などのプロパティではなく、`--shiki-light-font-style` / `--shiki-dark-font-style` (`-font-weight` / `-text-decoration` も同様) の変数だけで出る (Markdown の `*em*` と `**b**` で確認) **確認済** (実行)
- `github-light` と `github-dark` の `tokenColors` の `fontStyle` のルールは同一 **確認済** (テーマの定義を比較)

### Mermaid 12.2.0

- `mermaid.run` は `data-processed` 属性のある要素を飛ばす。ない要素には `data-processed="true"` を付け、要素の `innerHTML` をソースとして読み、描画した SVG で `innerHTML` を置き換える **確認済** (ソース。npm の `mermaid@12.2.0` の `dist/mermaid.core.mjs` の `run`)
- 描画した SVG には、そのときのテーマの設定から作った `<style>` が入る **確認済** (ソース。同ファイルの `createUserStyles` の呼び出し)
- テーマは `mermaid.initialize({ theme })` で指定する (reviewbuddy は `default` / `dark` を使っている) **確認済** (`src/web/mermaid.ts`)

### 読み込みの直後の配色

- module script (`type="module"`) は既定で defer され、HTML の解析が終わってから実行される。`type="module"` も `async` / `defer` も無いインラインの script は、実行されるまで解析を止める (描画は止めない) **確認済** (MDN)
- reviewbuddy のバンドル (`main.tsx` から作る module script) は、ビルドしたバイナリで 468KB あり、圧縮なし・`ETag` 付きで配信される **確認済** (実行。v0.4.0 の作業中のコードを `bun run build` でビルドしたもの)
- 保存した Light / Dark を `main.tsx` だけで反映すると、バンドルが届くまで OS の配色で描画される **確認済** (実行。Chrome)

  | 条件 | 属性が付いた時刻 | 最初の描画 (`first-paint`) |
  |------|------|------|
  | 手元 (制限なし)、`main.tsx` で反映 | 約 5〜14ms | 約 12〜24ms (属性の後) |
  | 遅延 600ms・300KB/s・キャッシュなし、`main.tsx` で反映 | 約 19.8 秒 (バンドルの到着の後) | OS がダークで Light を保存: 約 1.3 秒 (属性の前。ダークの背景が見える) |
  | 同じ条件、`<head>` のインラインの script で反映 | 約 0.6 秒 (HTML の解析中) | 約 1.3 秒以降 (属性の後) |

  時刻は `performance.now()` の値。属性の時刻は `MutationObserver` で取った。OS がライトで Dark を保存した場合、`main.tsx` だけでは最初の描画の記録が無かった (白い背景は描画として数えられないため) が、バンドルが届くまでライトのままである点は同じ
- Bun の HTML の import は、`src` の無いインラインの `<script>` をそのまま出力する。開発用のサーバー (`Bun.serve` の HTML import) でも、`bun build --compile` で作ったバイナリでも、`<head>` の中でスタイルシートと module script の前に残る **確認済** (実行。Bun 1.4.4)

***

## 重要な気づき

- **System は CSS だけで実現できる**。`:root` の `color-scheme: light dark` と `light-dark()` で OS に追従する。Light / Dark は `:root` の `color-scheme` を 1 つに固定すれば切り替わる
- **Shiki は `defaultColor: 'light-dark()'` にすると、色の切り替えに CSS の上書きが要らない**。ただし太字・斜体は変数でしか出ないので、それを当てる CSS が 1 つ要る。2 つのテーマで `fontStyle` のルールが同じため、ライト側の変数だけを当てればよい
- **Mermaid の図は、描き直さないと配色が変わらない**。テーマの色が SVG に埋め込まれるため。描き直すには、要素の中身をソースに戻し、`data-processed` を外してから `run` する
- **Popover API で、メニューの開閉と light dismiss をブラウザに任せられる**。矢印キーでの移動は自前で実装する
- **保存した Light / Dark は、`<head>` のインラインの script で反映しないと、遅い回線で反対の配色が見える**。module script は描画を止めないため。手元では差が出ず、`tailscale serve` などで離れた参加者が開いたときに目立つ
- `light-dark()` (2024 年 5 月) と Popover API (2024 年 4 月) は、ほぼ同じ時期に全ブラウザで使えるようになった。両方を使っても、対応するブラウザの範囲はほとんど変わらない

***

## 出典

> 出典: [MDN — light-dark()](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark) (確認日: 2026-10-26)

> 出典: [MDN — color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme) (確認日: 2026-10-26)

> 出典: [MDN — popover](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/popover) (確認日: 2026-10-26)

> 出典: [MDN — Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API) (確認日: 2026-10-26)

> 出典: [Shiki — Dual Themes](https://shiki.style/guide/dual-themes) (確認日: 2026-10-26。`defaultColor: 'light-dark()'` は light と dark の両方のテーマを要する。出力の形は手元の実行で確認)

> 出典: [npm — mermaid@12.2.0](https://www.npmjs.com/package/mermaid/v/12.2.0) (確認日: 2026-10-26。`dist/mermaid.core.mjs` を読んで確認)

> 出典: [MDN — &lt;script&gt;: The Script element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script) (確認日: 2026-10-26。`type="module"` と `defer`、`blocking` の注記)

> 出典: [Chrome DevTools Protocol — browser_protocol.json](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json) (確認日: 2026-10-26。`Emulation.setEmulatedMedia` の `features` (`MediaFeature` の `name` / `value`))
