// Nombre de cada sección, igual en la barra superior y en la animación de
// espera al cambiar de página.
const SECTIONS: Array<[string, string]> = [
  ["/inicio", "Inicio"],
  ["/productos", "Productos"],
  ["/inventario", "Inventario"],
  ["/compras", "Compras"],
  ["/caja", "Caja"],
  ["/tickets", "Tickets"],
  ["/cotizaciones", "Cotizaciones"],
  ["/apartados", "Apartados"],
  ["/etiquetas", "Etiquetas"],
  ["/ajustes", "Ajustes"],
  ["/administracion", "Administración"],
  ["/clientes", "Clientes"],
  ["/reportes", "Reportes"],
  ["/prueba-impresion", "Prueba de impresión"],
  ["/mas", "Más módulos"],
];

export function sectionTitle(pathname: string) {
  return (
    SECTIONS.find(([path]) => pathname.startsWith(path))?.[1] ??
    "Punto de venta"
  );
}
