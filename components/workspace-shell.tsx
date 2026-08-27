"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Boxes,
  CircleDollarSign,
  Grid2X2,
  House,
  LogOut,
  MapPin,
  Menu,
  Package,
  ShoppingCart,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const navigation: Array<{ href: string; label: string; icon: LucideIcon; secondary?: boolean }> = [
  { href: "/pos", label: "Venta", icon: ShoppingCart },
  { href: "/pos", label: "Inicio", icon: House, secondary: true },
  { href: "/productos", label: "Productos", icon: Package },
  { href: "/inventario", label: "Inventario", icon: Boxes },
  { href: "/pos", label: "Caja", icon: CircleDollarSign, secondary: true },
  { href: "/pos", label: "Más", icon: Grid2X2, secondary: true },
];

function moduleTitle(pathname: string) {
  if (pathname.startsWith("/productos")) return "Productos";
  if (pathname.startsWith("/inventario")) return "Inventario";
  return "Punto de venta";
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="workspace-shell">
      <aside className="nav-rail" aria-label="Navegación principal">
        <Link className="rail-brand" href="/pos" aria-label="Vaquero HUB">
          <Image src="/brand/emblema-blanco.png" alt="" width={64} height={42} priority />
        </Link>
        <nav className="rail-links">
          {navigation.map(({ href, label, icon: Icon, secondary }) => {
            const active = !secondary && pathname.startsWith(href);
            return (
              <Link className={active ? "rail-link active" : "rail-link"} href={href} key={label}>
                <Icon aria-hidden="true" strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <button className="rail-link rail-logout" type="button">
          <LogOut aria-hidden="true" strokeWidth={1.8} />
          <span>Salir</span>
        </button>
      </aside>

      <div className="workspace-content">
        <header className="app-topbar">
          <button className="mobile-menu" type="button" aria-label="Abrir navegación">
            <Menu aria-hidden="true" />
          </button>
          <h1>{moduleTitle(pathname)}</h1>
          <div className="location-pill">
            <MapPin aria-hidden="true" strokeWidth={1.8} />
            <span>La Piedad</span><i>·</i><strong>Caja 01</strong>
          </div>
          <div className="online-pill"><span />En línea</div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" aria-label="Notificaciones">
              <Bell aria-hidden="true" strokeWidth={1.8} />
            </button>
            <div className="active-user"><span>ML</span><strong>Mariana López</strong></div>
          </div>
        </header>
        <main className="workspace-main">{children}</main>
      </div>
    </div>
  );
}
