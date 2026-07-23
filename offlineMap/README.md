# オフライン地図プロトタイプ

一度オンラインで地図データを保存すれば、圏外でもリロード・タブ再訪後に地図が表示されることを確認するためのプロトタイプ。ラスターとベクターで保存戦略を分けている。

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` / `style.css` | UI。地図とコントロールは重ねず分離配置 |
| `app.js` | 地図・ストレージ・ダウンロードの全ロジック |
| `sw.js` | アプリシェル（HTML/JS/CSS/CDNライブラリ）のみ担当 |
| `ube.pmtiles` | 宇部周辺のベクタータイル抽出（約7MB、z0–15） |

## 2つの保存戦略

### ラスター + IndexedDB

- 「エリアをダウンロード」で対象範囲（z10–14、約130枚）のPNGタイルを`ArrayBuffer`としてIndexedDBへ保存する。
- 表示は `maplibregl.addProtocol("idbtile", ...)` で行う。IndexedDBを先に参照し、無ければネットワーク、それも失敗すれば透明タイルを返す。
- 暗黙の保存はしない。何が保存されているかを利用者が把握できる状態を保つため、保存は明示的なダウンロード操作に限定している。

### ベクター + PMTiles + OPFS

- タイルを1枚ずつ保存する代わりに、全タイルを単一アーカイブにまとめたPMTilesファイルを丸ごと保存する。
- オンライン時: `pmtiles://<URL>` でRange Requestにより必要な部分だけ読む。
- ダウンロード後: OPFSへストリーミング書き込みし（`createWritable`非対応環境ではIndexedDBにBlobとして保存）、`Blob.slice()`でランダムアクセスする`BlobSource`を`pmtiles.Protocol`に登録する。スタイル側はソースURLを`pmtiles://local-ube`に切り替えるだけで、同じ地図が出る。

`ube.pmtiles` はProtomapsの公式ビルドから次のコマンドで切り出した。必要範囲だけをRange Requestで取得するため、惑星全体のファイルをダウンロードせずに済む。

```
brew install pmtiles
pmtiles extract https://build.protomaps.com/20260717.pmtiles ube.pmtiles \
  --bbox=130.95,33.90,131.35,34.10
```

## Service Workerの役割を絞った理由

旧実装（`../offlineMap-old`）はSWがタイル配信にも関与していたが、この版ではSWはアプリシェルの保存だけに限定した。

- 地図データのオフライン化は`addProtocol` + IndexedDB/OPFSで完結し、SWを必要としない。関与させると「どの層に何が保存されているか」が追いにくくなる。
- シェルはネットワーク優先・失敗時キャッシュ。オンライン時は常に最新が届き、開発中のキャッシュ滞留も起きない。
- 例外としてグリフ（フォントpbf）だけはSWがキャッシュ優先で貯める。ラテン基本範囲はダウンロード時に先読みし、日本語（CJK・かな）はMapLibreの`localIdeographFontFamily`により端末フォントで描画されるため、グリフ取得自体が発生しない。ここは実測して確認した。

## ブラウザ内ストレージの使い分け

| 領域 | 用途 | 理由 |
|---|---|---|
| IndexedDB | ラスタータイル（個別Blob） | キー単位の出し入れと削除が容易 |
| OPFS | PMTilesファイル | 大きな単一ファイルへのランダムアクセスに向く |
| Cache Storage | シェル・グリフ | Request/Response単位のリソースに向く |

いずれも同一オリジンのクォータを共有し、Best-Effortのままではストレージ逼迫時にオリジンごと削除されうる。ダウンロード時に`navigator.storage.persist()`を要求し、パネルに`estimate()`の値を表示している。

## 既知の制約

- iOS Safariはホーム画面に追加していないサイトのストレージを7日間の非利用で削除する。コードでは回避できず、ホーム画面追加の案内が唯一の対策。
- ラスターのタイル取得元は`tile.openstreetmap.org`。OSMのタイル利用ポリシー上、一括取得は小規模に留めること（現状の範囲設定で約130枚）。範囲やズームを広げるなら自前ホスティングか商用タイルに切り替える。
- ラスターの保存範囲・ズームは`app.js`の`RASTER_AREA`にハードコードしている。表示中の画面範囲から計算する形にすれば汎用化できる。

## 動かし方と検証

```
http-server . -p 8123 -c-1
```

1. オンラインで開き、各モードのダウンロードを実行する。
2. DevTools → Network → 「Offline」にしてリロードする。シェルはSW、ラスターはIndexedDB、ベクターはOPFSから供給され、地図が表示される。

ページ内の`fetch`を全て遮断した状態でラスター表示を再構築し、ネットワーク要求0件のまま全タイルが描画されることを確認済み。

## アトリビューション

- ラスター: © OpenStreetMap contributors
- ベクター: © OpenStreetMap contributors, Protomaps
