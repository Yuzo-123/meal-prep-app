// 電波なしでも開くための仕掛け。画面のファイルを端末に覚えさせる。
// 画面を直したら、下の番号と src/js/app.js の APP_VERSION を一緒に上げる（上げないと古い画面が出続ける）。
const CACHE = "mealprep-0.12.4";
// 無いと画面が動かないもの（1 つでも取れなければ、この版は入れない）
const ASSETS = [
  "./", "./index.html", "./manifest.json", "./src/css/styles.css",
  "./src/js/app.js", "./src/js/model.js", "./src/js/planner.js", "./src/js/store.js", "./src/js/cloud.js",
];
// 無くても動くもの（取れなくても、ほかは入れる）
const OPTIONAL = ["./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png", "./icons/mascot.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) =>
    c.addAll(ASSETS).then(() => Promise.all(OPTIONAL.map((u) => c.add(u).catch(() => {}))))
  ));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      // 消すのは、このアプリの古い版の控えだけ（料理の写真の控えや、同じ公開先のほかのアプリの控えは残す）
      Promise.all(keys.filter((k) => /^mealprep-\d/.test(k) && k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== self.location.origin) return; // サーバー側とのやりとりには手を出さない
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).catch((err) => {
      // 電波が無いとき、ページを開く要求にだけ画面を返す（画像などに画面を返すと、壊れ方が分かりにくい）
      if (e.request.mode === "navigate") return caches.match("./index.html");
      throw err;
    }))
  );
});
