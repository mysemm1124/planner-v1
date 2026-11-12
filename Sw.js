// 네트워크 우선: 항상 최신 버전을 받고, 오프라인일 때만 저장해둔 걸 씀
const CACHE = "planner-v2";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const cacheable = url.origin === location.origin || url.hostname === "www.gstatic.com" || url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com");
  if (!cacheable) return; // Firebase 통신은 건드리지 않음
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match("./")))
  );
});

// 폰 알림: GitHub 자동 작업이 보낸 메시지를 알림으로 띄움
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) {}
  const data = d.data || d, n = d.notification || {};
  e.waitUntil(self.registration.showNotification(n.title || data.title || "Me.Plan", {
    body: n.body || data.body || "", icon: "icon-192.png", badge: "icon-192.png", tag: data.tag || "meplan", data: {url: data.url || "./"}
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({type: "window", includeUncontrolled: true}).then(ws => {
    for (const w of ws) if ("focus" in w) return w.focus();
    return clients.openWindow((e.notification.data && e.notification.data.url) || "./");
  }));
});
