# Integración candidata de mejoras operativas y main — 9 de octubre de 2026

Origen conservado sin cambios: `/Users/emmanueljuarez/Documents/Codex/mejoras-mi-tienda-octubre`, rama `codex/mejoras-operativas-octubre`, commit `e3d827e57427688edda0d527fced433377dc6e5c`.

Integración local aislada: `work/m9-mejoras-octubre-integracion`, rama `codex/integracion-operativa-octubre`, basada en main real `449974378bb6815440e17265aba2510b010ad213`, consultado desde GitHub. Fusión de tres vías sin conflictos. No sustituye la rama de trabajo de la migración.

La candidata incorpora los15puntos de `MEJORAS_OPERATIVAS_OCTUBRE.md`. Conserva byte a byte134archivos protegidos de main: migraciones existentes, herramientas M9 existentes en principal, Inicio y archivos de preguntas. La migración nueva `20261009200155_operational_october.sql` permanece idéntica al origen.126migraciones en el conjunto combinado. No se aplicó ninguna a una base remota ni se publicó esta rama.

## Verificación ejecutada en esta integración

-138pruebas unitarias/38archivos correctos.
-TypeScript, ESLint completos y compilación de producción Turbopack correctos.
-La primera compilación falló porque node_modules enlazaba fuera de la raíz; se copió a la candidata aislada. El segundo intento dentro del sandbox se detuvo y fue interrumpido; la compilación fuera del sandbox terminó correctamente. No se cambió next.config ni el código para eludir el error.
-Diferencias sin errores de whitespace; carpeta original limpia y preservada.

Las pruebas históricas de125migraciones y39recorridos descritas por el otro chat pertenecen a su candidata anterior, no se presentan como una aceptación nueva de esta integración. Se recomienda revisión Astra para el cambio financiero antes de publicación; no cambia automáticamente el modelo ni constituye aprobación financiera.

## Pendiente antes de publicar

1. Ensayar actualización incremental desde el esquema principal vigente, conservando códigos, saldo, movimientos y respuestas existentes. La sustitución comprobada del motor de venta debe encontrar exactamente las definiciones esperadas; no forzar una migración que rechace su fuente.
2. Aceptación Auth/PostgREST real en un entorno independiente de la carga M9: alta de cliente/categoría, entradas, conteos y permisos por usuario/sucursal. No usar el staging de importación para pruebas que generen existencias ficticias.
3. Pagos crédito/débito combinados, reintento y devolución; dos cajas y corte consolidado con turno abierto/faltante/concurrencia.
4. Campana con otro usuario, acuse y permisos; Safari y sonido en dispositivos reales.
5. Publicar esquema y aplicación coordinadamente cuando los controles anteriores pasen. USD y asignación fraccionaria continúan desactivados; no activar módulos ni conexión Woo por esta integración.

No se modificaron producción, WooCommerce, preguntas/respuestas ni catálogo/inventario del staging M9. El porcentaje de la migración no cambia por integrar estas mejoras del programa.

## Aceptación técnica posterior

La autorización de publicación fue recibida. La aceptación local Auth/PostgREST y el ensayo incremental se completaron en un proyecto independiente:126migraciones,178pruebas de integración,39de navegador y92tablas previas conservadas. Detalle, límites y correcciones del arnés en [ACEPTACION_OPERATIVA_OCTUBRE_2026_10_09.md](ACEPTACION_OPERATIVA_OCTUBRE_2026_10_09.md). No interpretar la lista inicial de pendientes como el estado vigente de esas pruebas. La comprobación física de Safari y sonido sigue correspondiendo a los equipos de tienda.
