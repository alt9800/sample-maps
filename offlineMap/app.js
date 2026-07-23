"use strict";

// ---- 設定 ----

// ラスター: 宇部市周辺（旧実装と同じ範囲）
const RASTER_AREA = {
    bounds: [[131.0, 33.95], [131.3, 34.05]],
    minZoom: 10,
    maxZoom: 14,
    center: [131.15, 34.0],
    zoom: 12
};
const rasterTileUrl = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

// ベクター: Protomaps公式ビルドから `pmtiles extract` で切り出した宇部周辺のPMTiles。
// 本番ではR2やGitHub Pagesなど任意の静的ホスティングに置けばよい
const PMTILES_REMOTE = new URL("ube.pmtiles", location.href).href;
const PMTILES_LOCAL_NAME = "ube.pmtiles";
const PMTILES_LOCAL_KEY = "local-ube";
const VECTOR_VIEW = { center: [131.15, 34.0], zoom: 12 };

const GLYPHS_URL = "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
const FONT = "Noto Sans Regular";
// ラテン文字の基本範囲のみ先読みする。日本語ラベルのグリフは範囲数が多いため、
// 表示時にオンデマンドで取得したものをService WorkerがCache Storageに貯める
const GLYPH_PREFETCH_RANGES = ["0-255", "256-511"];
const ASSET_CACHE = "assets-v1";

const TRANSPARENT_PNG = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0,
    0, 13, 73, 68, 65, 84, 120, 218, 98, 0, 0, 0, 0, 2, 0, 0, 5, 0,
    1, 226, 38, 5, 155, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]);

// ---- IndexedDB ----

const DB_NAME = "offline-map-proto";
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("raster-tiles")) db.createObjectStore("raster-tiles");
                if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return dbPromise;
}

async function idbRequest(storeName, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName], mode);
        const req = fn(tx.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

const idbGet = (store, key) => idbRequest(store, "readonly", s => s.get(key));
const idbPut = (store, key, value) => idbRequest(store, "readwrite", s => s.put(value, key));
const idbDelete = (store, key) => idbRequest(store, "readwrite", s => s.delete(key));
const idbClear = (store) => idbRequest(store, "readwrite", s => s.clear());
const idbCount = (store) => idbRequest(store, "readonly", s => s.count());

// ---- タイル座標計算 ----

function lngLatToTile(lng, lat, z) {
    const n = 2 ** z;
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y };
}

function enumerateTiles(bounds, minZoom, maxZoom) {
    const [[west, south], [east, north]] = bounds;
    const tiles = [];
    for (let z = minZoom; z <= maxZoom; z++) {
        const a = lngLatToTile(west, north, z);
        const b = lngLatToTile(east, south, z);
        for (let x = a.x; x <= b.x; x++) {
            for (let y = a.y; y <= b.y; y++) {
                tiles.push({ z, x, y });
            }
        }
    }
    return tiles;
}

// ---- MapLibre プロトコル ----

// ラスター: IndexedDB優先、無ければネットワーク。暗黙の保存はしない
maplibregl.addProtocol("idbtile", async (params) => {
    const m = params.url.match(/^idbtile:\/\/osm\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (!m) throw new Error(`invalid url: ${params.url}`);
    const [, z, x, y] = m;
    const cached = await idbGet("raster-tiles", `${z}/${x}/${y}`);
    if (cached) return { data: cached };
    try {
        const res = await fetch(rasterTileUrl(z, x, y));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { data: await res.arrayBuffer() };
    } catch (e) {
        return { data: TRANSPARENT_PNG.buffer.slice(0) };
    }
});

// ベクター: pmtilesライブラリのプロトコルをそのまま使う
const pmProtocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", pmProtocol.tile);

// Blob（OPFSのFile、またはIndexedDBのBlob）をpmtilesのソースにする
class BlobSource {
    constructor(blob, key) {
        this.blob = blob;
        this.key = key;
    }
    getKey() {
        return this.key;
    }
    async getBytes(offset, length) {
        const data = await this.blob.slice(offset, offset + length).arrayBuffer();
        return { data };
    }
}

// ---- ローカルPMTilesファイルの取得と保存 ----

async function getLocalPmtilesBlob() {
    // OPFSを先に見る
    if (navigator.storage && navigator.storage.getDirectory) {
        try {
            const root = await navigator.storage.getDirectory();
            const fh = await root.getFileHandle(PMTILES_LOCAL_NAME);
            return await fh.getFile();
        } catch (e) { /* 無ければフォールバックへ */ }
    }
    return (await idbGet("files", PMTILES_LOCAL_NAME)) || null;
}

async function deleteLocalPmtiles() {
    if (navigator.storage && navigator.storage.getDirectory) {
        try {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry(PMTILES_LOCAL_NAME);
        } catch (e) { /* 存在しない場合 */ }
    }
    await idbDelete("files", PMTILES_LOCAL_NAME);
}

async function downloadPmtiles(onProgress) {
    const res = await fetch(PMTILES_REMOTE);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get("Content-Length")) || 0;

    // OPFS + createWritable が使えるか判定（Safariの古い版では不可）
    let writable = null;
    let storageKind = "IndexedDB";
    if (navigator.storage && navigator.storage.getDirectory) {
        try {
            const root = await navigator.storage.getDirectory();
            const fh = await root.getFileHandle(PMTILES_LOCAL_NAME, { create: true });
            if (fh.createWritable) {
                writable = await fh.createWritable();
                storageKind = "OPFS";
            }
        } catch (e) { /* IndexedDBフォールバック */ }
    }

    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (writable) {
            await writable.write(value);
        } else {
            chunks.push(value);
        }
        onProgress(received, total);
    }
    if (writable) {
        await writable.close();
    } else {
        await idbPut("files", PMTILES_LOCAL_NAME, new Blob(chunks));
    }

    // ラベル描画に必要なグリフを先読みしてCache Storageへ
    try {
        const cache = await caches.open(ASSET_CACHE);
        const font = encodeURIComponent(FONT);
        await Promise.all(GLYPH_PREFETCH_RANGES.map(range =>
            cache.add(GLYPHS_URL.replace("{fontstack}", font).replace("{range}", range)).catch(() => {})
        ));
    } catch (e) { /* Cache Storage非対応環境 */ }

    return storageKind;
}

// ---- スタイル定義 ----

function rasterStyle() {
    return {
        version: 8,
        sources: {
            osm: {
                type: "raster",
                tiles: ["idbtile://osm/{z}/{x}/{y}.png"],
                tileSize: 256,
                maxzoom: 19,
                attribution: "© OpenStreetMap contributors"
            }
        },
        layers: [
            { id: "osm", type: "raster", source: "osm" }
        ]
    };
}

// フィレンツェPMTiles用の最小スタイル（Protomapsタイルスキーマ）
function vectorStyle(sourceUrl) {
    return {
        version: 8,
        glyphs: GLYPHS_URL,
        sources: {
            pm: {
                type: "vector",
                url: sourceUrl,
                attribution: "© OpenStreetMap contributors, Protomaps"
            }
        },
        layers: [
            { id: "background", type: "background", paint: { "background-color": "#f4f1ea" } },
            {
                id: "earth", type: "fill", source: "pm", "source-layer": "earth",
                paint: { "fill-color": "#f4f1ea" }
            },
            {
                id: "landuse", type: "fill", source: "pm", "source-layer": "landuse",
                paint: { "fill-color": "#e4e9dc", "fill-opacity": 0.7 }
            },
            {
                id: "water", type: "fill", source: "pm", "source-layer": "water",
                paint: { "fill-color": "#a8c8e0" }
            },
            {
                id: "roads-casing", type: "line", source: "pm", "source-layer": "roads",
                paint: { "line-color": "#d9d4c8", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 16, 8] }
            },
            {
                id: "roads", type: "line", source: "pm", "source-layer": "roads",
                paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 16, 5] }
            },
            {
                id: "buildings", type: "fill", source: "pm", "source-layer": "buildings",
                minzoom: 13,
                paint: { "fill-color": "#dcd6ca" }
            },
            {
                id: "places", type: "symbol", source: "pm", "source-layer": "places",
                layout: {
                    "text-field": ["get", "name"],
                    "text-font": [FONT],
                    "text-size": 13
                },
                paint: {
                    "text-color": "#333333",
                    "text-halo-color": "#ffffff",
                    "text-halo-width": 1.5
                }
            }
        ]
    };
}

// ---- UI ----

const $ = (id) => document.getElementById(id);

let map = null;
let currentMode = "raster";
let localPmtilesRegistered = false;

function setNetStatus() {
    const el = $("net-status");
    if (navigator.onLine) {
        el.textContent = "オンライン";
        el.className = "badge online";
    } else {
        el.textContent = "オフライン";
        el.className = "badge offline";
    }
}

function setSourceStatus(text) {
    $("source-status").textContent = text;
}

async function updateStorageInfo() {
    $("raster-count").textContent = await idbCount("raster-tiles").catch(() => "?");

    const blob = await getLocalPmtilesBlob();
    $("vector-file-status").textContent = blob
        ? `あり (${(blob.size / 1024 / 1024).toFixed(1)} MB)`
        : "なし";

    if (navigator.storage && navigator.storage.estimate) {
        const { usage, quota } = await navigator.storage.estimate();
        $("storage-usage").textContent =
            `${(usage / 1024 / 1024).toFixed(1)} MB / ${(quota / 1024 / 1024 / 1024).toFixed(1)} GB`;
    } else {
        $("storage-usage").textContent = "取得不可";
    }

    if (navigator.storage && navigator.storage.persisted) {
        $("persist-status").textContent = (await navigator.storage.persisted()) ? "granted" : "未許可";
    } else {
        $("persist-status").textContent = "非対応";
    }
}

async function vectorSourceUrl() {
    const blob = await getLocalPmtilesBlob();
    if (blob) {
        // Blobは毎回変わりうるので登録し直す
        pmProtocol.add(new pmtiles.PMTiles(new BlobSource(blob, PMTILES_LOCAL_KEY)));
        localPmtilesRegistered = true;
        return { url: `pmtiles://${PMTILES_LOCAL_KEY}`, local: true };
    }
    return { url: `pmtiles://${PMTILES_REMOTE}`, local: false };
}

async function applyMode(mode) {
    currentMode = mode;
    $("mode-raster").classList.toggle("active", mode === "raster");
    $("mode-vector").classList.toggle("active", mode === "vector");
    $("raster-section").hidden = mode !== "raster";
    $("vector-section").hidden = mode !== "vector";

    if (mode === "raster") {
        map.setStyle(rasterStyle());
        map.jumpTo({ center: RASTER_AREA.center, zoom: RASTER_AREA.zoom });
        setSourceStatus("IndexedDB優先 + ネットワーク");
    } else {
        const { url, local } = await vectorSourceUrl();
        map.setStyle(vectorStyle(url));
        map.jumpTo({ center: VECTOR_VIEW.center, zoom: VECTOR_VIEW.zoom });
        setSourceStatus(local ? "ローカルPMTiles" : "リモートPMTiles (Range Request)");
    }
}

async function downloadRasterArea() {
    const btn = $("dl-raster");
    const bar = $("raster-progress");
    const text = $("raster-progress-text");
    btn.disabled = true;
    bar.hidden = false;

    const tiles = enumerateTiles(RASTER_AREA.bounds, RASTER_AREA.minZoom, RASTER_AREA.maxZoom);
    let done = 0;
    let failed = 0;

    const CONCURRENCY = 6;
    const queue = tiles.slice();
    async function worker() {
        for (;;) {
            const t = queue.shift();
            if (!t) return;
            try {
                const res = await fetch(rasterTileUrl(t.z, t.x, t.y));
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                await idbPut("raster-tiles", `${t.z}/${t.x}/${t.y}`, await res.arrayBuffer());
            } catch (e) {
                failed++;
            }
            done++;
            bar.value = Math.round(done / tiles.length * 100);
            text.textContent = `${done} / ${tiles.length} 枚（失敗 ${failed}）`;
        }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    text.textContent = `完了: ${done - failed} 枚を保存（失敗 ${failed} 枚）`;
    btn.disabled = false;
    await updateStorageInfo();
}

async function downloadVectorFile() {
    const btn = $("dl-vector");
    const bar = $("vector-progress");
    const text = $("vector-progress-text");
    btn.disabled = true;
    bar.hidden = false;

    try {
        const kind = await downloadPmtiles((received, total) => {
            if (total) {
                bar.value = Math.round(received / total * 100);
                text.textContent = `${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`;
            } else {
                text.textContent = `${(received / 1024 / 1024).toFixed(1)} MB`;
            }
        });
        text.textContent = `完了（保存先: ${kind}）`;
        if (currentMode === "vector") await applyMode("vector");
    } catch (e) {
        text.textContent = `失敗: ${e.message}`;
    }

    btn.disabled = false;
    await updateStorageInfo();
}

function setupEvents() {
    $("mode-raster").addEventListener("click", () => applyMode("raster"));
    $("mode-vector").addEventListener("click", () => applyMode("vector"));
    $("dl-raster").addEventListener("click", downloadRasterArea);
    $("dl-vector").addEventListener("click", downloadVectorFile);

    $("clear-raster").addEventListener("click", async () => {
        if (!confirm("ラスターキャッシュを削除しますか？")) return;
        await idbClear("raster-tiles");
        await updateStorageInfo();
    });

    $("clear-vector").addEventListener("click", async () => {
        if (!confirm("ローカルのPMTilesファイルを削除しますか？")) return;
        await deleteLocalPmtiles();
        if (currentMode === "vector") await applyMode("vector");
        await updateStorageInfo();
    });

    $("req-persist").addEventListener("click", async () => {
        if (navigator.storage && navigator.storage.persist) {
            const granted = await navigator.storage.persist();
            $("persist-status").textContent = granted ? "granted" : "拒否されました";
        }
    });

    window.addEventListener("online", setNetStatus);
    window.addEventListener("offline", setNetStatus);
}

async function init() {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js").catch(e => {
            console.warn("Service Worker登録失敗:", e);
        });
    }

    map = new maplibregl.Map({
        container: "map",
        style: rasterStyle(),
        center: RASTER_AREA.center,
        zoom: RASTER_AREA.zoom,
        attributionControl: { compact: false },
        fadeDuration: 0,
        refreshExpiredTiles: false
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    // 環境によっては構築時にコンテナサイズが確定しておらず、内蔵のtrackResizeも
    // 発火しないことがあるため、コンテナを自前でも監視する
    const container = document.getElementById("map");
    new ResizeObserver(() => map.resize()).observe(container);
    requestAnimationFrame(() => map.resize());

    setNetStatus();
    setSourceStatus("IndexedDB優先 + ネットワーク");
    setupEvents();
    await updateStorageInfo();
}

// スタイルシート適用前にマップを構築するとキャンバスサイズが確定しないため、load後に初期化する
if (document.readyState === "complete") {
    init();
} else {
    window.addEventListener("load", init);
}
