import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  FileText,
  Gift,
  PackageCheck,
  Settings,
  Tags,
  Truck,
  Users,
} from "lucide-react";

export const metadata: Metadata = { title: "Más módulos" };

const modules = [
  { href: "/tickets", title: "Tickets", description: "Consulta, reimpresión y tickets de regalo.", icon: FileText, ready: true },
  { href: "/etiquetas", title: "Etiquetas y códigos", description: "Busca códigos SICAR y prepara etiquetas para imprimir.", icon: Tags, ready: true },
  { href: "/ajustes", title: "Ajustes", description: "Sucursales, apariencia, POS, tickets y preferencias.", icon: Settings, ready: true },
  { href: "#", title: "Compras", description: "Órdenes, recepción y diferencias de mercancía.", icon: PackageCheck, ready: false },
  { href: "#", title: "Proveedores", description: "Contactos, condiciones y catálogo por proveedor.", icon: Truck, ready: false },
  { href: "#", title: "Transferencias", description: "Movimientos controlados entre sucursales.", icon: Boxes, ready: false },
  { href: "/administracion", title: "Usuarios y permisos", description: "Empleados, sucursales, roles y bitácora protegidos.", icon: Users, ready: true },
  { href: "#", title: "Reportes", description: "Ventas, inventario, caja y conciliación.", icon: BarChart3, ready: false },
  { href: "/clientes", title: "Clientes", description: "Alta, búsqueda y número de socio; lealtad se activará al definir sus reglas.", icon: Gift, ready: true },
];

export default function MorePage() {
  return (
    <section className="module-page">
      <div className="section-heading"><div><p className="eyebrow">Mi Tienda SM</p><h1>Todos los módulos</h1><p className="heading-copy">Herramientas actuales y módulos contemplados para el crecimiento.</p></div></div>
      <div className="module-grid">
        {modules.map(({ href, title, description, icon: Icon, ready }) => ready ? (
          <Link className="module-card" href={href} key={title}><span className="module-icon"><Icon aria-hidden="true" /></span><span><strong>{title}</strong><small>{description}</small></span><ArrowRight aria-hidden="true" /></Link>
        ) : (
          <article className="module-card coming-soon" key={title}><span className="module-icon"><Icon aria-hidden="true" /></span><span><strong>{title}</strong><small>{description}</small></span><em>Próximamente</em></article>
        ))}
      </div>
    </section>
  );
}
