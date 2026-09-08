import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "http", hostname: "127.0.0.1", port: "54321" },
    ],
  },
  experimental: {
    serverActions: {
      // Permite la plantilla (máx. 1 MB) y el JSON normalizado de confirmación,
      // manteniendo un límite explícito contra consumo excesivo de recursos.
      // Las fotos de producto se validan a 4 MB en servidor. Este margen
      // incluye los demás campos multipart sin permitir cargas abiertas.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
