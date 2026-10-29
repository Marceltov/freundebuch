// freundebuch's service worker, for one job: Android's share sheet POSTs a shared file to /teilen/eingang (the manifest's
// share_target). The worker keeps the image in a cache and sends the browser on to /teilen, which uploads it with the
// sign-in cookie (backend/share-route.ts). Everything else goes to the network untouched.
const INBOX = "freundebuch-share-inbox";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== "/teilen/eingang") return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const cache = await caches.open(INBOX);
      let n = 0;
      // "file" since files; "image" as the manifest named it before.
      for (const file of [...form.getAll("file"), ...form.getAll("image")]) {
        if (!(file instanceof File)) continue;
        await cache.put(`/teilen/eingang/${Date.now()}-${n++}`, new Response(file, { headers: { "content-type": file.type || "application/octet-stream" } }));
      }
      return Response.redirect("/teilen", 303);
    })(),
  );
});
