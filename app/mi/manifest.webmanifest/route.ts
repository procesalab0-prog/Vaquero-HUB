import type { NextRequest } from "next/server";

export function GET(request: NextRequest) {
  const configuredHost = process.env.CUSTOMER_APP_HOST?.toLowerCase();
  const requestHost = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  const dedicatedOrigin = Boolean(configuredHost && requestHost === configuredHost);
  return Response.json({
    name: "Mi Vaquero · Vaquero SM",
    short_name: "Mi Vaquero",
    description: "Tarjeta digital de cliente de Vaquero SM.",
    start_url: dedicatedOrigin ? "/" : "/mi",
    scope: dedicatedOrigin ? "/" : "/mi",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F4F2EF",
    theme_color: "#8E2A1C",
    lang: "es-MX",
    categories: ["shopping", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, { headers: { "Cache-Control": "public, max-age=3600", "Content-Type": "application/manifest+json" } });
}
