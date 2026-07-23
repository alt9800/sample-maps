// アプリシェル（HTML/JS/CSS）のキャッシュだけを担当する。
// 地図データ本体（ラスタータイル・PMTiles）はページ側がIndexedDB / OPFSで管理する。

const SHELL_CACHE = "shell-v2";
const ASSET_CACHE = "assets-v1";

const SHELL_ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js",
    "https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.css",
    "https://unpkg.com/pmtiles@4.3.0/dist/pmtiles.js"
];

self.addEventListener("install", (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS))
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            await self.clients.claim();
            const names = await caches.keys();
            await Promise.all(
                names
                    .filter(n => n !== SHELL_CACHE && n !== ASSET_CACHE)
                    .map(n => caches.delete(n))
            );
        })()
    );
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // グリフ・スプライト類: キャッシュ優先、初回取得時に保存
    if (url.hostname === "protomaps.github.io") {
        event.respondWith(
            (async () => {
                const cache = await caches.open(ASSET_CACHE);
                const hit = await cache.match(event.request);
                if (hit) return hit;
                const res = await fetch(event.request);
                if (res.ok) cache.put(event.request, res.clone());
                return res;
            })()
        );
        return;
    }

    // 地図データ（タイル・PMTiles）はページ側がIndexedDB / OPFSで管理するので、SWは触らない
    if (url.pathname.endsWith(".pmtiles")) return;
    const isShell = url.origin === self.location.origin || url.hostname === "unpkg.com";
    if (!isShell) return;

    // アプリシェル: ネットワーク優先。成功したら差し替え、失敗（圏外）時はキャッシュから返す
    event.respondWith(
        (async () => {
            const cache = await caches.open(SHELL_CACHE);
            try {
                const res = await fetch(event.request);
                if (res.ok && event.request.method === "GET") {
                    cache.put(event.request, res.clone());
                }
                return res;
            } catch (e) {
                const hit = await cache.match(event.request);
                if (hit) return hit;
                throw e;
            }
        })()
    );
});
