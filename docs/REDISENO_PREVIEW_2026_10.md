# Rediseño Mi Tienda SM — vista previa local

## Integración autorizada · 0.57.0 · 7 de octubre de 2026

El usuario aprobó el diseño y pidió pasarlo a main. La integración se prepara
sobre `9f80142`, aplicando únicamente los commits de diseño posteriores a
`772b498`. Se conservan las preguntas de M9 al inicio y la corrección de los
manifiestos ya existente en main. No se incluyen cambios de esquema, datos,
Mi Vaquero ni scripts de migración. Las notas de vista previa siguientes
describen el historial de validación, no el estado actual de autorización.

Versión: `0.57.0`, “Mi Tienda SM · Identidad Vaquero y ergonomía”.
Validación de la integración: lint, formato, compilación/TypeScript,
113 pruebas unitarias y las 234 pruebas de navegador completas correctas,
incluidas la instalación separada de Mi Vaquero y su funcionamiento offline.
No se ejecutaron escrituras ni pruebas sobre la base de producción.

## Aislamiento e integración

- Directorio: `/Users/emmanueljuarez/Documents/Codex/rediseno-mi-tienda`.
- Rama: `codex/rediseno-ergonomia`.
- Base operativa preservada en `772b498`: copia de los pendientes locales de
  `codex/usd-costos-compras`, NO una publicación de estos pendientes.
- Para integrar el rediseño, revisar solamente los cambios posteriores a esa
  base. No fusionar toda la rama sin conciliar primero la integración operativa
  y M9 que se realizan en otro chat.
- La vista previa original permaneció sin publicar hasta la aprobación del
  usuario indicada arriba.

## Dirección aplicada

Identidad crema, negro y acentos configurables. Archivo para lectura operativa,
números tabulares y jerarquía sin tipografía editorial en cifras y encabezados.
Los emblemas oficiales se conservan sin deformación. La capa compartida abarca
las pantallas dentro de WorkspaceShell; no modifica Mi Vaquero, login público,
reglas financieras, permisos ni migraciones.

Navegación lateral expandida/compacta en escritorio, accesos inferiores en
móvil y menú de módulos con búsqueda insensible a acentos. El menú conserva el
contexto de sucursal, usa diálogo nativo con foco contenido, Escape y retorno
del foco al botón de apertura. Los destinos mantienen sus controles de acceso.

Venta: catálogo y carrito en paneles independientes; herramientas secundarias
plegables; cliente, total y cobro fuera de ese menú. Microinteracciones de
160 ms, únicamente sin preferencia de movimiento reducido.

La hoja `app/workspace-redesign.css` está limitada a pantalla y al workspace:
no modifica la tipografía ni las dimensiones de tickets y etiquetas impresos.

## Verificación

- Tipos TypeScript y ESLint de los componentes modificados: correctos.
- Revisión automatizada de Inicio, Venta, Productos, Inventario, Caja, Compras,
  Cotizaciones, Clientes, Reportes y Más a 1440×1000, 768×1024 y 390×844.
- Sin desbordamiento horizontal del documento. Las tablas pueden conservar su
  propio desplazamiento horizontal para no eliminar columnas.
- Búsqueda del menú, Escape, retorno del foco y barra superior dentro del
  viewport comprobados en los tres tamaños; capturas adicionales con xlarge.
- Primer conjunto de 66 pruebas de navegador de catálogo, compras, POS y
  producto rápido: correcto. Los cobros son simulados, no operaciones reales.
- La compilación estable completa ejecutó 192 pruebas: 182 correctas y 10
  fallidas. Ocho fallos eran la selección ambigua de `main` durante Suspense;
  la prueba ahora selecciona `.workspace-main`. Dos corresponden al manifiesto
  de Mi Vaquero: se obtiene `/manifest.webmanifest` en lugar de
  `/mi/manifest.webmanifest`. No se modificó el código de la PWA como parte
  del rediseño; este hallazgo debe resolverse antes de publicar la rama completa.
- Repetición de las 56 pruebas de navegación/scroll con selector corregido:
  todas correctas. Las seis pruebas nuevas de menú y navegación plegable
  también pasaron sobre la compilación estable.
- Capturas locales: `/tmp/mi-tienda-redesign/`.

## Cómo abrir y probar

### Segunda revisión: identidad Vaquero y navegación contextual

- Encabezado de marca en Inicio y emblemas oficiales en barra y botón Cobrar.
- Más abre sus enlaces dentro de la navegación, sin cambiar de pantalla;
  en teléfono es un panel sobre la barra inferior. Se cierra con su botón,
  con Escape desde el disparador, o al elegir un destino. Conserva sucursal.
- Paletas Identidad, Vino, Cuero, Noche, Mezclilla, Bosque y Cobre. Ahora
  colorean barra, botones principales, fondo suave, métricas y encabezado.
  Noche es una paleta de acento oscuro, no un modo oscuro de toda la pantalla.
- Animaciones CSS de entrada y respuesta, sin bucles, video, canvas ni nuevas
  dependencias; se omiten con `prefers-reduced-motion`.
- Compilación, TypeScript y ESLint correctos; 94 pruebas de apariencia,
  navegación, menú contextual y Venta correctas en Chromium escritorio/móvil.
- Sin publicación a main. El pendiente del manifiesto sigue separado.

Vista previa local: `http://127.0.0.1:3127/pos`.

### Ergonomía: Venta, fichas y formularios

- Venta agrupa por producto (ID real; nombre/marca solo en demostración),
  permite elegir talla/color sin añadir ni cobrar, e indica cuántas unidades
  están en el carrito. El botón de esa variante se deshabilita al agotar
  su disponibilidad; el escaneo conserva su recorrido directo existente.
- Productos despliega una ficha de variantes a todo el ancho con códigos,
  precios y acceso a Inventario por código, preservando sucursal. El detalle
  solo se monta cuando se solicita para evitar duplicar listas ocultas.
- Inventario conserva el código al recargar y muestra agotadas/reservadas
  por grupo. No se suman unidades de medida incompatibles. No se presenta
  stock ficticio en Productos (su carga actual no incluye existencias).
- Buscadores de catálogo persistentes, selección múltiple resaltada y
  acciones de formulario consistentes/persistentes con objetivos de 44 px.
- Confirmación visual discreta en carrito y transición de selección sin
  bucles; se respeta movimiento reducido. Fotos a cargo de M9, sin cambios
  a migración, permisos, reglas financieras, PWA ni plantillas impresas.
- La consulta consolidada de stock de todas las sucursales dentro de la
  ficha queda pendiente de integrar datos autorizados; el acceso actual
  abre Inventario filtrado en la sucursal seleccionada.
- Verificación: compilación, tipos y ESLint correctos; 116 pruebas de
  catálogo, inventario, Venta, ventanas y rediseño correctas. Tras el ajuste
  final del panel al ancho de tabla se repitieron las 34 de catálogo y
  ergonomía, todas correctas. Recorrido de 10 pantallas en tres tamaños sin
  desbordamiento horizontal; Safari/iPad físico siguen pendientes.

### Iconografía propia Vaquero

- SVG de trazo único: bota para Productos, sombrero para Más/Módulos e
  insignia con palomita para Usuarios y permisos. Conservan textos accesibles,
  heredan el color de la paleta y no agregan dependencias ni animación continua.
- Los logos oficiales, iconos de pago y controles críticos no se modifican.
- Compilación, TypeScript y ESLint correctos; 16 pruebas de navegación,
  paletas y accesibilidad correctas tras el cambio. Solo vista previa local.

### Tercera revisión: reconocimiento y cobro rápido

- Cobrar conserva verde operativo, independiente de la paleta decorativa.
- Accesos con icono y color para efectivo, tarjeta, transferencia y dividido,
  colocados junto al total, fuera del desplazamiento de productos. En móvil
  están dentro del carrito desplegable, accesible desde la barra persistente.
- Los accesos abren el flujo de pago existente. No confirman ni registran
  ninguna venta por sí mismos; conservan las validaciones del cobro.
- Más usa símbolos funcionales con distintivos de color y nombres visibles;
  el emblema del caballo se conserva en la marca y Cobrar, sin sustituir
  iconos de función por decoraciones ambiguas.
- Compilación, TypeScript y ESLint correctos. Las 68 pruebas de Venta,
  ventanas móviles y rediseño pasaron en Chromium escritorio/móvil;
  incluyen los cuatro accesos rápidos a 390, 768 y 1440 px.

Servidor: `node node_modules/next/dist/bin/next dev --webpack --hostname
127.0.0.1 --port 3127` con Node disponible en PATH.

Regresión: `node node_modules/@playwright/test/cli.js test --config
playwright.redesign.config.ts --workers=2` con el servidor anterior activo.
Recorrido visual: `node scripts/verify-redesign.mjs`.

Pendiente antes de publicación: aprobación visual del usuario, prueba en
Safari/iPad real y conciliación de la base operativa con main. La verificación
local no sustituye la aceptación sobre sesiones y permisos reales.
