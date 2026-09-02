import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Permite la plantilla (máx. 1 MB) y el JSON normalizado de confirmación,
      // manteniendo un límite explícito contra consumo excesivo de recursos.
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
