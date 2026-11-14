// 電波なしでも開くための仕掛け。画面のファイルを端末に覚えさせる。
// 画面を直したら、下の番号と src/js/app.js の APP_VERSION を一緒に上げる（上げないと古い画面が出続ける）。
const CACHE = "mealprep-0.3.0";
const ASSETS = [
  "./", "./index.html", "./manifest.json", "./src/css/styles.css",
  "./src/js/app.js", "./src/js/model.js", "./src/js/store.js",
  "./icons/icon-192.png", "./icons/icon-512.png",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).catch(() => caches.match("./index.html")))
  );
});
