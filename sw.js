// 오프라인 실행용: 앱 파일을 폰에 보관합니다. (명함 데이터와는 별개)
const VER = "myeonham-v1";
const FILES = ["./", "index.html", "app.js", "parse.js", "manifest.webmanifest",
  "icon-192.png", "icon-512.png", "apple-touch-icon.png",
  "lib/tesseract.min.js", "lib/worker.min.js",
  "lib/core/tesseract-core-lstm.wasm.js", "lib/core/tesseract-core-simd-lstm.wasm.js",
  "lib/lang/kor.traineddata.gz", "lib/lang/eng.traineddata.gz"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VER).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
