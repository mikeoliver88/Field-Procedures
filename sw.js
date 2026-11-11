// Field Procedures — service worker (v3)
//
// The app page
//   • Tries the network so you always get the newest version when you have signal.
//   • Never makes you wait on a weak signal: after a few seconds it shows the copy saved
//     on this phone and quietly stores the fresh one for next time.
//   • No signal at all: shows the saved copy. The app works fully offline.
// Behind a sign-in gate (invite-only hosting)
//   • A redirect to the sign-in page is passed straight through so you can sign in.
//   • It is NEVER stored in place of the app, so an expired sign-in can't break offline use.
//
// You should not need to touch this file again. Uploading a new index.html is enough.

const CACHE_NAME = "field-procedures-v3";
const PAGE_KEY = "./index.html";
const NET_TIMEOUT_MS = 3500;
const STATIC = ["./index.json", "./manifest.json", "./icon-192.png", "./icon-512.png", "./icon-180.png"];

// A stored copy must be a plain response (browsers refuse to show a "redirected" one for a page load).
async function plainCopy(res){
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
const isRealPage = (res) => !!res && res.ok && res.type === "basic";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try{
      const res = await fetch("./", { cache: "no-store" });
      if(isRealPage(res)) await cache.put(PAGE_KEY, await plainCopy(res));
    } catch(e){}
    await Promise.all(STATIC.map((url) => cache.add(url).catch(() => null)));   // one missing file can't break install
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function pageResponse(event){
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(PAGE_KEY);

  const network = fetch(event.request, { cache: "no-store" }).then(async (res) => {
    if(isRealPage(res)) await cache.put(PAGE_KEY, await plainCopy(res.clone()));
    return res;
  });
  event.waitUntil(network.catch(() => null));   // let a slow download finish and be saved

  if(!cached){
    try{ return await network; }
    catch(e){
      return new Response("You're offline and the app hasn't been saved on this phone yet. Open it once with signal.",
        { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  }
  const timer = new Promise((resolve) => setTimeout(() => resolve(null), NET_TIMEOUT_MS));
  const res = await Promise.race([network.catch(() => null), timer]);
  if(res && (isRealPage(res) || res.type === "opaqueredirect")) return res;   // fresh app, or a sign-in redirect to follow
  return cached;                                                             // slow, offline, or an error page
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  const isAppPage = req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html");
  if(isAppPage){ event.respondWith(pageResponse(event)); return; }

  // Icons and the manifest: saved copy first, otherwise fetch and keep it (only if it's a real file).
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if(cached) return cached;
    const res = await fetch(req);
    if(isRealPage(res)){ const cache = await caches.open(CACHE_NAME); cache.put(req, res.clone()); }
    return res;
  })());
});
