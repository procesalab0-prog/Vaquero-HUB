import Image from "next/image";

// Pantalla de carga de Mi Tienda SM. Se ve sólo mientras el sistema realmente
// carga —al abrir el programa y justo después de iniciar sesión— y nunca
// agrega espera. Repite la composición del acceso, así el telón de entrada
// arranca exactamente desde aquí y se recoge hacia el riel.
export function WorkspaceBoot() {
  return (
    <main className="workspace-boot" aria-busy="true">
      <div className="workspace-boot-panel">
        <span className="workspace-boot-logo">
          <Image
            src="/brand/logo-vaquerosm-blanco.png"
            alt=""
            width={520}
            height={226}
            priority
          />
        </span>
        <p role="status">
          Abriendo Mi Tienda SM…
          <span className="workspace-boot-progress" aria-hidden="true" />
        </p>
      </div>
    </main>
  );
}
