import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const configuredHost = process.env.CUSTOMER_APP_HOST?.toLowerCase();
  const requestHost = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  const dedicatedOrigin = Boolean(
    configuredHost && requestHost === configuredHost,
  );
  const shell = dedicatedOrigin ? "/" : "/mi";
  const scope = dedicatedOrigin ? "/" : "/mi";
  const source = `
const CACHE = "mi-vaquero-editorial-v1";
const SHELL = ${JSON.stringify(shell)};
const DEDICATED = ${JSON.stringify(dedicatedOrigin)};
const STATIC = [SHELL, "/mi/manifest.webmanifest", "/icons/mi-vaquero/icon-192.png", "/icons/mi-vaquero/icon-512.png", "/mi-media/portrait-man.webp", "/fonts/pt-sans-regular.ttf"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("mi-vaquero-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || request.headers.has("range") || url.pathname.startsWith("/api/") || url.pathname.endsWith(".mp4") || request.headers.get("RSC") === "1") return;
  if (request.mode === "navigate") {
    const isCustomerPage = url.pathname === "/mi" || url.pathname.startsWith("/mi/") || (DEDICATED && url.pathname === "/");
    if (!isCustomerPage) return;
    event.respondWith(fetch(request).then((response) => {
      if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(SHELL, copy)));
      }
      return response;
    }).catch(async () => (await caches.match(SHELL)) || Response.error()));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/mi-vaquero/") || url.pathname.startsWith("/brand/") || url.pathname.startsWith("/mi-media/") || url.pathname.startsWith("/fonts/")) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.status === 200) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
      }
      return response;
    })));
  }
});`;
  return new Response(source, {
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": scope,
    },
  });
}
