import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vaquero HUB",
    short_name: "Vaquero HUB",
    description: "Sistema operativo de punto de venta e inventario para Vaquero SM.",
    start_url: "/inicio",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#F4F2EF",
    theme_color: "#8E2A1C",
    lang: "es-MX",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
