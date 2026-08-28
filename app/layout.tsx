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
  metadataBase: new URL("https://vaquero-hub.vercel.app"),
  applicationName: "Vaquero HUB",
  title: {
    default: "Vaquero HUB",
    template: "%s · Vaquero HUB",
  },
  description: "Punto de venta y operación de Vaquero SM.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Vaquero HUB" },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    locale: "es_MX",
    siteName: "Vaquero HUB",
    title: "Vaquero HUB · Vaquero SM",
    description: "Punto de venta, inventario y operación de Vaquero SM.",
    images: [{ url: "/share-vaquero-hub.png", width: 1200, height: 630, alt: "Vaquero HUB" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vaquero HUB · Vaquero SM",
    description: "Punto de venta, inventario y operación de Vaquero SM.",
    images: ["/share-vaquero-hub.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#8E2A1C",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-MX">
      <body className={`${archivo.variable} ${plexMono.variable} ${cormorant.variable}`}>
        {children}
      </body>
    </html>
  );
}
