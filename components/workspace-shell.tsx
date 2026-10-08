"use client";

import Image from "next/image";
import { ProcesaLabCredit } from "@/components/procesalab-credit";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
import { useEffect, useMemo, useState } from "react";
import { APP_RELEASE, APP_VERSION } from "@/lib/release";
import { ACCENT_EVENT, applyAccent, storedAccent } from "@/lib/accent";
import {
  Bell,
  ArrowLeft,
  Boxes,
  CircleDollarSign,
  House,
  LogOut,
  MapPin,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  ReceiptText,
  Users,
  CalendarClock,
  FileText,
  Truck,
  Tags,
  ChartNoAxesCombined,
  Settings,
  ShoppingCart,
  X,
} from "lucide-react";
import { WesternBootIcon, WesternHatIcon, WesternBadgeIcon, type WorkspaceIcon } from "@/components/vaquero-icons";
import type { WorkspaceIdentity } from "@/lib/auth/types";
import { WorkspaceContext } from "@/components/workspace-context";
import { EntranceCurtain, useEntrance } from "@/components/entrance-curtain";
import { WorkspaceModuleMenu } from "@/components/workspace-module-menu";
import { LA_PIEDAD_STORE } from "@/lib/business-profile";
import { pickActiveLocation, saveActiveLocationPreference } from "@/lib/location-preference";
import { WORKSPACE_NOTIFICATION_EVENT, type WorkspaceNotification } from "@/lib/workspace-notifications";

// Cuánto se queda el aviso en pantalla. La barra del aviso muestra este mismo
// tiempo, así que se declara una sola vez.
const NOTICE_TOAST_MS = 5000;

const navigation: Array<{
  href: string;
  label: string;
  icon: WorkspaceIcon;
  secondary?: boolean;
}> = [
  { href: "/inicio", label: "Inicio", icon: House },
  { href: "/pos", label: "Venta", icon: ShoppingCart },
  { href: "/productos", label: "Productos", icon: WesternBootIcon },
  { href: "/inventario", label: "Inventario", icon: Boxes },
  { href: "/caja", label: "Caja", icon: CircleDollarSign },
  { href: "/mas", label: "Más", icon: WesternHatIcon },
];

const demoIdentity: WorkspaceIdentity = {
  id: "demo",
  name: "Salomon",
  employeeCode: "SALOMON",
  role: "Administrador",
  roleCode: "ADMIN",
  locations: [LA_PIEDAD_STORE],
  openCashSession: { locationId: LA_PIEDAD_STORE.id, registerName: "Caja 01" },
};

const moreNavigation: Array<{ path: string; title: string; icon: WorkspaceIcon; tone: string }> = [
  { path: "/tickets", title: "Tickets y devoluciones", icon: ReceiptText, tone: "sand" },
  { path: "/clientes", title: "Clientes", icon: Users, tone: "blue" },
  { path: "/apartados", title: "Apartados", icon: CalendarClock, tone: "gold" },
  { path: "/cotizaciones", title: "Cotizaciones", icon: FileText, tone: "blue" },
  { path: "/compras", title: "Compras y proveedores", icon: Truck, tone: "green" },
  { path: "/etiquetas", title: "Etiquetas", icon: Tags, tone: "sand" },
  { path: "/reportes", title: "Reportes", icon: ChartNoAxesCombined, tone: "green" },
  { path: "/administracion", title: "Usuarios y permisos", icon: WesternBadgeIcon, tone: "gold" },
  { path: "/ajustes", title: "Ajustes y apariencia", icon: Settings, tone: "sand" },
];

function moduleTitle(pathname: string) {
  if (pathname.startsWith("/inicio")) return "Inicio";
  if (pathname.startsWith("/productos")) return "Productos";
  if (pathname.startsWith("/inventario")) return "Inventario";
  if (pathname.startsWith("/compras")) return "Compras";
  if (pathname.startsWith("/caja")) return "Caja";
  if (pathname.startsWith("/tickets")) return "Tickets";
  if (pathname.startsWith("/cotizaciones")) return "Cotizaciones";
  if (pathname.startsWith("/apartados")) return "Apartados";
  if (pathname.startsWith("/etiquetas")) return "Etiquetas";
  if (pathname.startsWith("/ajustes")) return "Ajustes";
  if (pathname.startsWith("/administracion")) return "Administración";
  if (pathname.startsWith("/clientes")) return "Clientes";
  if (pathname.startsWith("/reportes")) return "Reportes";
  if (pathname.startsWith("/mas")) return "Más módulos";
  return "Punto de venta";
}

export function WorkspaceShell({
  children,
  identity,
  initialLocationId = "",
}: {
  children: React.ReactNode;
  identity: WorkspaceIdentity | null;
  initialLocationId?: string;
}) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { scene: entranceScene, finish: finishEntrance } = useEntrance();
  const searchParams = useSearchParams();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notices, setNotices] = useState<WorkspaceNotification[]>([]);
  const [noticeToast, setNoticeToast] = useState<WorkspaceNotification | null>(null);
  // Avisos que llegaron desde la última vez que se abrió la campana, y un
  // contador que reinicia el balanceo con cada aviso nuevo.
  const [unreadNotices, setUnreadNotices] = useState(0);
  const [bellRing, setBellRing] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(true);
  const [navigationCompact, setNavigationCompact] = useState(false);
  const activeIdentity = identity ?? demoIdentity;
  const activeLocation = pickActiveLocation(
    activeIdentity.locations,
    searchParams.get("ubicacion") ?? undefined,
    initialLocationId,
  );
  const activeLocationId = activeLocation?.id ?? "";
  const locationNotices = notices.filter((notice) => notice.locationId === activeLocationId);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const receive = (event: Event) => {
      const notice = (event as CustomEvent<WorkspaceNotification>).detail;
      if (!notice || notice.locationId !== activeLocationId) return;
      setNotices((current) => [notice, ...current.filter((item) => item.id !== notice.id)].slice(0, 20));
      setNoticeToast(notice);
      setUnreadNotices((count) => count + 1);
      setBellRing((count) => count + 1);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setNoticeToast(null), NOTICE_TOAST_MS);
    };
    window.addEventListener(WORKSPACE_NOTIFICATION_EVENT, receive);
    return () => { window.removeEventListener(WORKSPACE_NOTIFICATION_EVENT, receive); if (timer) clearTimeout(timer); };
  }, [activeLocationId]);
  useEffect(() => {
    saveActiveLocationPreference(activeLocationId);
  }, [activeLocationId]);
  const cashLocation = activeIdentity.locations.find(
    (location) => location.id === activeIdentity.openCashSession?.locationId,
  );
  const cashLabel = activeIdentity.openCashSession
    ? activeIdentity.openCashSession.locationId === activeLocationId
      ? activeIdentity.openCashSession.registerName
      : `${activeIdentity.openCashSession.registerName} en ${cashLocation?.name ?? "otra sucursal"}`
    : "Sin caja abierta";
  const workspaceContext = useMemo(
    () => ({
      identity: activeIdentity,
      activeLocation: activeLocation ?? null,
    }),
    [activeIdentity, activeLocation],
  );
  const initial = activeIdentity.name.trim().charAt(0).toUpperCase() || "V";

  useEffect(() => {
    const saved =
      window.localStorage.getItem("mi-tienda:text-size:v1") ?? "normal";
    document.documentElement.dataset.textSize = saved;
    const syncTextSize = (event: Event) => {
      const value = (event as CustomEvent<string>).detail;
      if (value) document.documentElement.dataset.textSize = value;
    };
    // Sin acento elegido no se fuerza ninguno: el de la identidad lo define
    // workspace-brand.css. Forzar aquí un valor dejaba ese diseño sin efecto.
    applyAccent(storedAccent());
    const syncAccent = (event: Event) => {
      applyAccent((event as CustomEvent<string>).detail || null);
    };
    window.addEventListener("mi-tienda:text-size", syncTextSize);
    window.addEventListener(ACCENT_EVENT, syncAccent);
    return () => {
      window.removeEventListener("mi-tienda:text-size", syncTextSize);
      window.removeEventListener(ACCENT_EVENT, syncAccent);
    };
  }, []);

  function locationHref(href: string) {
    if (!activeLocationId) return href;
    const [path, query = ""] = href.split("?");
    const params = new URLSearchParams(query);
    params.set("ubicacion", activeLocationId);
    return `${path}?${params.toString()}`;
  }

  function changeLocation(locationId: string) {
    saveActiveLocationPreference(locationId);
    const next = new URLSearchParams(window.location.search);
    next.set("ubicacion", locationId);
    startNavigationProgress();
    router.replace(`${pathname}?${next.toString()}`);
  }

  if (!identity && !loggedIn) {
    return (
      <main className="mock-login">
        <Image
          className="login-app-icon"
          src="/icons/icon-192.png"
          alt="Mi Tienda SM"
          width={120}
          height={120}
          priority
        />
        <p className="eyebrow">Mi Tienda SM</p>
        <h1>Sesión cerrada</h1>
        <p>La sesión local de {activeIdentity.name} terminó correctamente.</p>
        <button
          className="primary-button"
          type="button"
          onClick={() => setLoggedIn(true)}
        >
          Entrar como Salomon
        </button>
        <small>
          La autenticación segura se conectará con usuarios y permisos.
        </small>
      </main>
    );
  }

  return (
    <div className={`workspace-shell workspace-redesign${navigationCompact ? " navigation-compact" : ""}`} data-entrance={entranceScene === "full" ? "full" : undefined}>
      {entranceScene === "full" ? <EntranceCurtain onDone={finishEntrance} /> : null}
      <aside className="nav-rail" aria-label="Navegación principal">
        <Link
          className="rail-brand"
          href={locationHref("/pos")}
          aria-label="Mi Tienda SM"
        >
          <Image
            src="/brand/emblema-blanco.png"
            alt=""
            width={64}
            height={42}
            priority
          />
        </Link>
        <span className="rail-wordmark">Mi Tienda <small>VAQUERO SM · LA ESENCIA ESTÁ AQUÍ</small></span>
        <button className="rail-collapse" type="button" aria-label={navigationCompact ? "Ampliar navegación" : "Contraer navegación"} aria-expanded={!navigationCompact} aria-controls="workspace-navigation" onClick={() => setNavigationCompact((value) => !value)}>
          {navigationCompact ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          <span>Contraer menú</span>
        </button>
        <nav className="rail-links" id="workspace-navigation">
          {navigation.map(({ href, label, icon: Icon }) => {
            const morePath = [
              "/mas",
              "/tickets",
              "/cotizaciones",
              "/apartados",
              "/etiquetas",
              "/ajustes",
              "/administracion",
              "/clientes",
              "/compras",
              "/reportes",
            ];
            const active =
              href === "/mas"
                ? morePath.some((path) => pathname.startsWith(path))
                : pathname.startsWith(href);
            if (href === "/mas") return (
              <details className="rail-more" key={label}>
                <summary className={active ? "rail-link active" : "rail-link"} aria-label="Más opciones" title="Más opciones" onKeyDown={(event) => {
                if (event.key === "Escape") {
                  const details = event.currentTarget.closest("details");
                  if (details) details.open = false;
                  event.currentTarget.focus();
                }
              }}>
                  <WesternHatIcon /><span>Más</span><ChevronDown className="rail-more-chevron" aria-hidden="true" />
                </summary>
                <div className="rail-submenu">
                  <div className="rail-submenu-heading"><p className="rail-submenu-title">Todo en tu tienda</p><button type="button" aria-label="Cerrar más opciones" onClick={(event) => { const details = event.currentTarget.closest("details"); if (details) { details.open = false; details.querySelector("summary")?.focus(); } }}><X aria-hidden="true" /></button></div>
                  {moreNavigation.map(({path, title, icon: Icon, tone}) => <Link key={path} href={locationHref(path)} aria-current={pathname.startsWith(path) ? "page" : undefined} onClick={(event) => {
                    const details = event.currentTarget.closest("details");
                    if (details) details.open = false;
                  }}><span className={`rail-module-icon ${tone}`}><Icon aria-hidden="true" strokeWidth={1.8} /></span><span>{title}</span></Link>)}
                  <Link className="rail-all-modules" href={locationHref("/mas")} onClick={(event) => { const details = event.currentTarget.closest("details"); if (details) details.open = false; }}>Ver todos los módulos</Link>
                </div>
              </details>
            );
            return (
              <Link
                className={active ? "rail-link active" : "rail-link"}
                href={locationHref(href)}
                key={label}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                title={label}
              >
                <Icon aria-hidden="true" strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <button
          className="rail-link rail-logout"
          type="button"
          onClick={() => setLogoutOpen(true)}
        >
          <LogOut aria-hidden="true" strokeWidth={1.8} />
          <span>Salir</span>
        </button>
        <div className="rail-developer-credit"><ProcesaLabCredit dark /></div>
      </aside>

      <div className="workspace-content">
        <header className="app-topbar">
          {pathname !== "/inicio" ? (
            <button
              className="topbar-back"
              type="button"
              aria-label="Regresar"
              onClick={() => {
                if (window.history.length > 1) router.back();
                else {
                  startNavigationProgress();
                  router.push(locationHref("/inicio"));
                }
              }}
            >
              <ArrowLeft aria-hidden="true" />
            </button>
          ) : null}
          <Link
            className="mobile-menu"
            href={locationHref("/mas")}
            aria-label="Abrir más módulos"
          >
            <Menu aria-hidden="true" />
          </Link>
          <h1>{moduleTitle(pathname)}</h1>
          <div
            className="location-pill"
            title={`${activeLocation?.name ?? "Sin sucursal"} · ${cashLabel}`}
          >
            <MapPin aria-hidden="true" strokeWidth={1.8} />
            {activeIdentity.locations.length > 1 ? (
              <select
                aria-label="Sucursal activa"
                value={activeLocationId}
                onChange={(event) => changeLocation(event.target.value)}
              >
                {activeIdentity.locations.map((location) => (
                  <option value={location.id} key={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="location-name">
                {activeLocation?.name ?? "Sin sucursal"}
              </span>
            )}
            <i>·</i>
            <strong className="cash-name">{cashLabel}</strong>
          </div>
          <div className="online-pill">
            <span />
            En línea
          </div>
          <div className="topbar-actions">
            <WorkspaceModuleMenu locationId={activeLocationId} />
            <button
              className="icon-button notification-trigger"
              type="button"
              aria-label="Notificaciones"
              aria-expanded={notificationsOpen}
              onClick={() => {
                setProfileOpen(false);
                setNotificationsOpen((current) => !current);
                setUnreadNotices(0);
              }}
            >
              <Bell aria-hidden="true" strokeWidth={1.8} className={bellRing ? `bell-ring-${bellRing % 2}` : undefined} />
              {unreadNotices ? <span aria-hidden="true" className={`bell-count bell-pop-${bellRing % 2}`}>{unreadNotices > 9 ? "9+" : unreadNotices}</span> : null}
            </button>
            <button
              className="active-user"
              type="button"
              aria-label={`Abrir información de ${activeIdentity.name} y versión`}
              aria-expanded={profileOpen}
              onClick={() => {
                setNotificationsOpen(false);
                setProfileOpen((current) => !current);
              }}
            >
              <span>{initial}</span>
              <strong>{activeIdentity.name}</strong>
            </button>
          </div>
        </header>
        <WorkspaceContext.Provider value={workspaceContext}>
          <main className="workspace-main">{children}</main>
        </WorkspaceContext.Provider>
      </div>
      {notificationsOpen ? (
        <aside className="notifications-popover" aria-label="Notificaciones">
          <header>
            <strong>Notificaciones</strong>
            <button
              type="button"
              aria-label="Cerrar notificaciones"
              onClick={() => setNotificationsOpen(false)}
            >
              <X aria-hidden="true" />
            </button>
          </header>
          {locationNotices.length ? locationNotices.map((notice) => <article key={notice.id}>
            <span className="notification-dot" /><div><strong>{notice.title}</strong><p>{notice.message}</p></div>
            <small>{new Date(notice.createdAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</small>
          </article>) : <p>No hay avisos en esta sesión para la sucursal seleccionada.</p>}
          <Link
            href={locationHref("/inventario")}
            onClick={() => setNotificationsOpen(false)}
          >
            Ver inventario
          </Link>
        </aside>
      ) : null}
      {noticeToast?.locationId === activeLocationId ? <aside key={noticeToast.id} className="workspace-notification-toast" data-kind={noticeToast.kind ?? "success"} role={noticeToast.kind === "error" ? "alert" : "status"} style={{ "--notice-ms": `${NOTICE_TOAST_MS}ms` } as React.CSSProperties}><strong>{noticeToast.title}</strong><span>{noticeToast.message}</span><button type="button" aria-label="Cerrar aviso" onClick={() => setNoticeToast(null)}><X aria-hidden="true" /></button><i className="workspace-notification-timer" aria-hidden="true" /></aside> : null}
      {profileOpen ? (
        <aside
          className="profile-popover"
          aria-label="Información de usuario y versión"
        >
          <header>
            <span>{initial}</span>
            <div>
              <strong>{activeIdentity.name}</strong>
              <small>
                {activeIdentity.role} · {activeLocation?.name ?? "Sin sucursal"}
              </small>
            </div>
            <button
              type="button"
              aria-label="Cerrar información"
              onClick={() => setProfileOpen(false)}
            >
              <X aria-hidden="true" />
            </button>
          </header>
          <div className="version-easter-egg">
            <span>MI TIENDA SM</span>
            <strong>Versión {APP_VERSION}</strong>
            <small>{APP_RELEASE}</small>
            <code>Siempre al día 🤠</code>
            <div className="version-credit">
              <ProcesaLabCredit dark />
            </div>
          </div>
          <p>
            Este número cambia con cada entrega visible para identificar
            exactamente qué versión está instalada.
          </p>
        </aside>
      ) : null}
      {logoutOpen ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal compact-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-title"
          >
            <p className="eyebrow">Seguridad</p>
            <h2 id="logout-title">¿Cerrar sesión?</h2>
            <p>Las operaciones guardadas permanecerán en el sistema.</p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setLogoutOpen(false)}
              >
                Cancelar
              </button>
              {identity ? (
                <form action="/auth/signout" method="post">
                  <button className="primary-button" type="submit">
                    Cerrar sesión
                  </button>
                </form>
              ) : (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    setLogoutOpen(false);
                    setLoggedIn(false);
                  }}
                >
                  Cerrar sesión
                </button>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
