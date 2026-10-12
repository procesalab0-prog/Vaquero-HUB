import Image from "next/image";

// Pantalla de carga de Mi Tienda SM. Se ve sólo mientras el sistema realmente
// carga —al abrir el programa y justo después de iniciar sesión—. Es la misma
// composición que la pantalla del logo de la entrada, así el relevo entre ambas
// no se nota.
export function WorkspaceBoot() {
  return (
    <main className="workspace-boot" aria-busy="true">
      <span className="brand-logo-shine">
        <Image
          src="/brand/logo-vaquerosm-blanco-recortado.png"
          alt=""
          width={480}
          height={350}
          priority
        />
        <span className="nav-wait-shine" aria-hidden="true">
          <i />
        </span>
      </span>
      <p className="sr-only" role="status">
        Abriendo Mi Tienda SM…
      </p>
    </main>
  );
}
