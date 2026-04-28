const CACHE_NAME = "andashi-drop-v2";
const STATIC_ASSETS = ["/", "/index.html", "/offline.html", "/img/my_logo2.png", "/manifest.json"];

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
    self.skipWaiting();
});

self.addEventListener("activate", (e) => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
    self.clients.claim();
});

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    // Always network-first for API and sockets
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/") || e.request.method !== "GET") {
        e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({error:"Offline"}),{headers:{"Content-Type":"application/json"}})));
        return;
    }
    // Pages: network first, cache fallback, offline page last
    if (e.request.mode === "navigate") {
        e.respondWith(fetch(e.request).then(r => { caches.open(CACHE_NAME).then(c=>c.put(e.request,r.clone())); return r; }).catch(() => caches.match(e.request).then(c => c || caches.match("/offline.html"))));
        return;
    }
    // Assets: cache first
    e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).then(r => { caches.open(CACHE_NAME).then(cache=>cache.put(e.request,r.clone())); return r; })));
});

self.addEventListener("push", (e) => {
    const d = e.data?.json() || {};
    self.registration.showNotification(d.title||"ANDASHI-DROP", { body:d.body||"New file received", icon:"/img/my_logo2.png", badge:"/img/my_logo2.png", vibrate:[200,100,200] });
});