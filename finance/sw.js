// 오프라인에서도 앱 틀이 열리도록 앱 파일만 캐시합니다. 시세·환율 데이터는 항상 실시간 조회(캐시 안 함).
// 앱 파일은 네트워크 우선(최신 배포가 항상 바로 보이게) — 오프라인일 때만 캐시로 대체.
const VER = "findash-v4";
const FILES = ["./", "index.html", "app.js", "manifest.webmanifest",
  "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VER).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // 외부 API 호출은 그대로 네트워크로
  e.respondWith(
    // no-cache: GitHub Pages의 10분 HTTP 캐시를 건너뛰고 서버에 바뀌었는지 확인(안 바뀌었으면 304라 가벼움)
    fetch(e.request, { cache: "no-cache" }).then(res => {
      const copy = res.clone();
      caches.open(VER).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
