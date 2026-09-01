import type { Metadata, Viewport } from "next";
import { Archivo, Cormorant_Garamond, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000"),
  ),
  applicationName: "Mi Tienda SM",
  title: {
    default: "Mi Tienda SM",
    template: "%s · Mi Tienda SM",
  },
  description: "Punto de venta y operación de Vaquero SM.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Mi Tienda SM",
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    locale: "es_MX",
    siteName: "Mi Tienda SM",
    title: "Mi Tienda SM · Vaquero SM",
    description: "Punto de venta, inventario y operación de Vaquero SM.",
    images: [
      {
        url: "/share-mi-tienda-sm.png",
        width: 1200,
        height: 630,
        alt: "Mi Tienda SM",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mi Tienda SM · Vaquero SM",
    description: "Punto de venta, inventario y operación de Vaquero SM.",
    images: ["/share-mi-tienda-sm.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#8E2A1C",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body
        className={`${archivo.variable} ${plexMono.variable} ${cormorant.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
