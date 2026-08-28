"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { APP_RELEASE, APP_VERSION } from "@/lib/release";
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
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const navigation: Array<{ href: string; label: string; icon: LucideIcon; secondary?: boolean }> = [
  { href: "/inicio", label: "Inicio", icon: House },
  { href: "/pos", label: "Venta", icon: ShoppingCart },
  { href: "/productos", label: "Productos", icon: Package },
  { href: "/inventario", label: "Inventario", icon: Boxes },
  { href: "/caja", label: "Caja", icon: CircleDollarSign },
  { href: "/mas", label: "Más", icon: Grid2X2 },
];

function moduleTitle(pathname: string) {
  if (pathname.startsWith("/inicio")) return "Inicio";
  if (pathname.startsWith("/productos")) return "Productos";
  if (pathname.startsWith("/inventario")) return "Inventario";
  if (pathname.startsWith("/caja")) return "Caja";
  if (pathname.startsWith("/tickets")) return "Tickets";
  if (pathname.startsWith("/etiquetas")) return "Etiquetas";
  if (pathname.startsWith("/ajustes")) return "Ajustes";
  if (pathname.startsWith("/mas")) return "Más módulos";
  return "Punto de venta";
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(true);

  if (!loggedIn) {
    return (
      <main className="mock-login">
        <Image className="login-app-icon" src="/icons/icon-192.png" alt="Vaquero HUB" width={120} height={120} priority />
        <p className="eyebrow">Vaquero HUB</p><h1>Sesión cerrada</h1><p>La sesión local de Salomon terminó correctamente.</p>
        <button className="primary-button" type="button" onClick={() => setLoggedIn(true)}>Entrar como Salomon</button>
        <small>La autenticación segura se conectará con usuarios y permisos.</small>
      </main>
    );
  }

  return (
    <div className="workspace-shell">
      <aside className="nav-rail" aria-label="Navegación principal">
        <Link className="rail-brand" href="/pos" aria-label="Vaquero HUB">
          <Image src="/brand/emblema-blanco.png" alt="" width={64} height={42} priority />
        </Link>
        <nav className="rail-links">
          {navigation.map(({ href, label, icon: Icon }) => {
            const morePath = ["/mas", "/tickets", "/etiquetas", "/ajustes"];
            const active = href === "/mas"
              ? morePath.some((path) => pathname.startsWith(path))
              : pathname.startsWith(href);
            return (
              <Link className={active ? "rail-link active" : "rail-link"} href={href} key={label}>
                <Icon aria-hidden="true" strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <button className="rail-link rail-logout" type="button" onClick={() => setLogoutOpen(true)}>
          <LogOut aria-hidden="true" strokeWidth={1.8} />
          <span>Salir</span>
        </button>
      </aside>

      <div className="workspace-content">
        <header className="app-topbar">
          <Link className="mobile-menu" href="/mas" aria-label="Abrir más módulos">
            <Menu aria-hidden="true" />
          </Link>
          <h1>{moduleTitle(pathname)}</h1>
          <div className="location-pill">
            <MapPin aria-hidden="true" strokeWidth={1.8} />
            <span>La Piedad</span><i>·</i><strong>Caja 01</strong>
          </div>
          <div className="online-pill"><span />En línea</div>
          <div className="topbar-actions">
            <button className="icon-button notification-trigger" type="button" aria-label="Notificaciones" aria-expanded={notificationsOpen} onClick={() => { setProfileOpen(false); setNotificationsOpen((current) => !current); }}>
              <Bell aria-hidden="true" strokeWidth={1.8} />
              <span aria-hidden="true" />
            </button>
            <button className="active-user" type="button" aria-label="Abrir información de Salomon y versión" aria-expanded={profileOpen} onClick={() => { setNotificationsOpen(false); setProfileOpen((current) => !current); }}><span>S</span><strong>Salomon</strong></button>
          </div>
        </header>
        <main className="workspace-main">{children}</main>
      </div>
      {notificationsOpen ? (
        <aside className="notifications-popover" aria-label="Notificaciones">
          <header><strong>Notificaciones</strong><button type="button" aria-label="Cerrar notificaciones" onClick={() => setNotificationsOpen(false)}><X aria-hidden="true" /></button></header>
          <article><span className="notification-dot warning" /><div><strong>Última pieza</strong><p>Bota Cuadra café, talla 26.</p></div><small>Ahora</small></article>
          <article><span className="notification-dot" /><div><strong>Caja en orden</strong><p>La sesión lleva 8 ventas registradas.</p></div><small>14:32</small></article>
          <Link href="/inventario" onClick={() => setNotificationsOpen(false)}>Ver inventario</Link>
        </aside>
      ) : null}
      {profileOpen ? (
        <aside className="profile-popover" aria-label="Información de usuario y versión">
          <header><span>S</span><div><strong>Salomon</strong><small>Administrador · La Piedad</small></div><button type="button" aria-label="Cerrar información" onClick={() => setProfileOpen(false)}><X aria-hidden="true" /></button></header>
          <div className="version-easter-egg"><span>VAQUERO HUB</span><strong>Versión {APP_VERSION}</strong><small>{APP_RELEASE}</small><code>Siempre al día 🤠</code></div>
          <p>Este número cambia con cada entrega visible para identificar exactamente qué versión está instalada.</p>
        </aside>
      ) : null}
      {logoutOpen ? (
        <div className="modal-backdrop">
          <section className="checkout-modal compact-modal" role="dialog" aria-modal="true" aria-labelledby="logout-title">
            <p className="eyebrow">Seguridad</p><h2 id="logout-title">¿Cerrar sesión?</h2><p>Las operaciones guardadas permanecerán en el sistema.</p>
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setLogoutOpen(false)}>Cancelar</button><button className="primary-button" type="button" onClick={() => { setLogoutOpen(false); setLoggedIn(false); }}>Cerrar sesión</button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
