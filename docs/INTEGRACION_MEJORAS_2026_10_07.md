# Integración de mejoras operativas — candidata 0.56.0

Origen: `/Users/emmanueljuarez/Documents/Codex/qa-caja-inicio-compras`, rama
`codex/usd-costos-compras`, HEAD `5366bd4`. Se conservaron los 123 archivos
modificados/nuevos sin hacer commits, limpiar ni modificar esa carpeta.
El respaldo externo contiene cada archivo, su SHA-256, estado original y patch.

Base de integración: main `e45ef5bc46f0d5a2016e6f17f327ad8976df3fff`.
Se combinó el trabajo local en una copia independiente mediante merge de tres
vías. De los archivos añadidos/cambiados por main, sólo Inicio, Plan Maestro y
package.json requieren combinación; los demás se conservaron exactamente.
Las preguntas de M9 continúan arriba de Inicio, con sus botones visibles.

Incluye ergonomía, notas privadas/compartidas, avisos con sonido optativo,
cotizaciones personalizadas, PDF para proveedores, escaneo exacto, producto
rápido, filtros de reportes, costo promedio ponderado y soporte de unidades/USD.
Dólares y asignación fraccionaria siguen desactivados desde la base.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Unitarias | 113 aprobadas |
| Auth/PostgREST reales en Docker | 171 aprobadas, también sobre la actualización incremental |
| Navegador, compilación de producción | 186 aprobadas |
| Migraciones desde cero | 123 correctas |
| Actualización incremental de main | 101 → 123 correctas |
| Concurrencia financiera | Dos conexiones reales; costos, conteos, stock, cambio y corte USD correctos |
| Captura React de cantidades y USD | Correcta; pruebas aisladas |
| Tipos, lint, formato y compilación | Correctos |

Las cuatro pruebas nuevas comprueban compuerta USD, privacidad financiera,
asignación fraccionaria bloqueada sin cambiar identidad, costo rechazado a
cajera y cobro rápido concurrente idempotente sin crear variantes/movimientos.
El ensayo incremental conservó exactamente variantes, códigos, saldos,
movimientos, preguntas y una respuesta de M9 existentes; después guardó una
nota nueva y consultó la respuesta usando Auth/PostgREST reales.
Los datos de todos estos ensayos son sintéticos locales.

La prueba incremental es reproducible con `scripts/verify-operational-upgrade.mjs`:
requiere el runtime local `../qa-upgrade-runtime`, identificador exacto
`mi-tienda-upgrade-20261007`, puertos 57321/57322 y las 101 migraciones de la base
main indicada, todavía sin las 22 nuevas. Rechaza otra base o una repetición.
No resetea bases, no llama a APIs de administración remotas y no obtiene claves
alojadas. Usa las credenciales locales generadas por Supabase CLI sin imprimirlas.
Para reconstrucción/concurrencia, `pnpm test:sql:native` exige otra base local
vacía `qa_*`; sus auxiliares Auth sintéticos no se confunden con la suite real.

## Coordinación con M9

QA usa servicios locales exclusivos (56321/56322 y 57321/57322).
No se aplicó ninguna migración ni se desplegó aplicación en staging compartido,
producción o WooCommerce. No se leyeron ni sobrescribieron sus datos operativos.
Las 101 migraciones de main permanecen sin modificaciones.

La rama completa de M9 `facdc38` comparte siete archivos con esta integración:
Inicio, POS/page, Productos/actions, Productos/page, Productos/workspace,
Plan Maestro y package.json. Al unirla posteriormente, combinar ambas versiones;
conservar fichas web/fotos, permisos, identidades y catálogo M9. Esta candidata
no debe sustituir la rama `codex/m9-staging-review` ni su despliegue.

## Antes de publicar

Esta versión es candidata y no está publicada en main.

1. Revisar y aceptar el cambio financiero y la interacción humana en los equipos
   de mostrador. Chromium no certifica impresoras, lector ni audio físico/Safari.
2. Ensayar el mismo incremento sobre una copia alojada independiente; nunca
   resetear staging de M9 para ejecutar las fixtures de integración.
3. Promover las 22 migraciones pendientes y la aplicación de forma coordinada.
   Sus fechas son anteriores a la última migración de main: no usar un push
   automático que omita las pendientes ni reescribir su historial.
4. Configurar el token oficial de Banxico y validar su consulta antes de activar
   USD. No activar fracciones hasta su aceptación explícita completa.

Un Preview que herede la base compartida de M9 todavía no tiene este esquema:
no usarlo para operaciones de aceptación hasta asignarle una base compatible.
Las pruebas locales no autorizan importar existencias ni escribir en Woo real.
