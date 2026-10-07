"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { WesternHatIcon } from "@/components/vaquero-icons";

const groups = [
  { title: "Mostrador", links: [["/pos", "Venta", "Escanear y cobrar"], ["/tickets", "Tickets", "Consultar, cambiar o devolver"], ["/clientes", "Clientes", "Datos e historial"], ["/cotizaciones", "Cotizaciones", "Propuestas personalizadas"], ["/apartados", "Apartados", "Abonos y entregas"]] },
  { title: "Operación", links: [["/productos", "Productos", "Catálogo y variantes"], ["/inventario", "Inventario", "Existencias, conteos y traspasos"], ["/compras", "Compras", "Órdenes y recepción"], ["/compras?tab=proveedores", "Proveedores", "Contactos y pedidos"], ["/etiquetas", "Etiquetas", "Preparar impresión"]] },
  { title: "Administración", links: [["/caja", "Caja", "Turnos, movimientos y corte"], ["/reportes", "Reportes", "Resultados de la tienda"], ["/administracion", "Usuarios y permisos", "Equipo y sucursales"], ["/ajustes", "Ajustes", "Apariencia y preferencias"]] },
];
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function WorkspaceModuleMenu({ locationId }: { locationId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const matches = groups.map((group) => ({ ...group, links: group.links.filter((link) => normalize(link.slice(1).join(" ")).includes(normalize(query))) }));
  const close = () => { dialog.current?.close(); };
  const href = (path: string) => {
    const [route, search] = path.split("?");
    const params = new URLSearchParams(search);
    if (locationId) params.set("ubicacion", locationId);
    return `${route}${params.size ? `?${params}` : ""}`;
  };
  return <>
    <button ref={trigger} className="module-menu-trigger" type="button" aria-label="Buscar un módulo" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setQuery(""); dialog.current?.showModal(); setOpen(true); }}><WesternHatIcon /><span>Módulos</span></button>
    <dialog ref={dialog} className="module-menu-dialog" aria-labelledby="module-menu-title" onClose={() => { setOpen(false); trigger.current?.focus(); }}>
      <header><div><p className="eyebrow">Mi Tienda SM</p><h2 id="module-menu-title">¿Qué necesitas hacer?</h2></div><button type="button" className="icon-button" aria-label="Cerrar menú de módulos" onClick={close}><X aria-hidden="true" /></button></header>
      <label className="module-menu-search"><Search aria-hidden="true" /><input aria-label="Buscar módulo" placeholder="Busca ventas, pedidos, clientes…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="module-menu-groups">{matches.map((group) => group.links.length ? <section key={group.title}><h3>{group.title}</h3>{group.links.map(([path, title, description]) => <Link key={path} href={href(path)} onClick={close}><span><strong>{title}</strong><small>{description}</small></span><ArrowUpRight aria-hidden="true" /></Link>)}</section> : null)}
        {!matches.some((group) => group.links.length) ? <p role="status">No hay módulos con ese nombre. Prueba otra búsqueda.</p> : null}
      </div>
      <footer>Esc para cerrar · Tab para navegar</footer>
    </dialog>
  </>;
}
