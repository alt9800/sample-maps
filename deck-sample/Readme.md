
[readgeojson](./readgeojson)

DeckGLを用いてスキャッタープロットを行いつつ、ラインレイヤーを描画するサンプル。
地図はCartoを通じてOSMを利用する。(XYZタイルも利用できるけど)



[arc](./arc)


弧を描くリボンを描画するサンプル。
クリックした点群間を結ぶ。


ドキュメント
https://deck.gl/docs/api-reference/layers/arc-layer


[sync-rotate-hover](./sync-rotate-hover)

MapLibre GL JS と deck.gl を組み合わせて、
MaipLibreで読み込んだタイルレイヤーの上にDeckGLの地物レイヤーを重ねている様子



[button-overlay](./button-overlay)

deck.glの操作パネルを作る例



[sync-rotate](./sync-rotate)

deck.glとMapLibreのコントロールを同期させた例。
deckglのカメラをMapLibreのインスタンスに追従させている。

[sync-rotate+change-background](./sync-rotate+change-background)

deck.glとMapLibreのコントロールを同期させつつ、ベースマップのコントロールをパネルで行えるようにしている。