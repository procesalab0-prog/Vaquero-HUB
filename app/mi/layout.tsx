import type { Metadata, Viewport } from "next";
import "./mi.css";

export const metadata: Metadata = {
  applicationName: "Mi Vaquero",
  title: { default: "Mi Vaquero", template: "%s · Mi Vaquero" },
  description: "Tu tarjeta digital de cliente de Vaquero SM.",
  manifest: "/mi/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Mi Vaquero" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#8E2A1C",
};

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
