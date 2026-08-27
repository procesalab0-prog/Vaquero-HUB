import Link from "next/link";

const navigation = [
  ["/pos", "Punto de venta"],
  ["/productos", "Productos"],
  ["/inventario", "Inventario"],
] as const;

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="workspace">
      <aside className="sidebar" aria-label="Navegación principal">
        <Link className="brand" href="/pos" aria-label="Vaquero HUB, inicio">
          <span className="brand-mark">VH</span>
          <span><strong>Vaquero</strong><small>HUB</small></span>
        </Link>
        <nav className="primary-nav">
          {navigation.map(([href, label]) => (
            <Link href={href} key={href}>{label}</Link>
          ))}
        </nav>
        <div className="session-summary">
          <span className="status-dot" aria-hidden="true" />
          <div><strong>Caja 01</strong><small>Sesión abierta</small></div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div><strong>La Piedad</strong><small>Sucursal activa</small></div>
          <div className="user-badge"><span>ML</span><div><strong>Mariana López</strong><small>Cajera</small></div></div>
        </header>
        {children}
      </main>
    </div>
  );
}
