Leafletの地図を二分割して表示し、左右が同期的に動く例を作れないかと試行錯誤した。

仕組みとしては地図レイヤーを2つ読み込んで来て、上位レイヤー(z軸が大きいレイヤー)の右端をどこまで表示するか、というのを分割線で規定している。


npmでモジュールを読み込んで使う以外にはCDNで読み込むことが難しそうだったので、
Side-by-Sydeの実装をCSSなどを引き剥がしつつ分解して実装し直した。

## 参考実装

https://github.com/digidem/leaflet-side-by-side?tab=readme-ov-file

https://github.com/QuantStack/leaflet-splitmap


side-by-sideプラグインについては日本語でも紹介記事がある

https://www.memo.dayjournal.dev/memo/leaflet-037/

https://day-journal.com/example/leaflet-037/

## その他

一般には、画像比較は[image-compare](https://github.com/kylewetton/image-compare-viewer)を使うと楽。

https://image-compare-viewer.netlify.app/


https://alt9800.github.io/markup-exp/swiper/

上記を参考に分割線を作り直しても良いかも。
