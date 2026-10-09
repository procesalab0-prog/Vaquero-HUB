# Aceptación operativa de octubre — 9 de octubre de 2026

Candidata basada en main4499743 y entrega e3d827e. Autorización del usuario: integrar y publicar en main para poder probar el programa. La integración no carga el catálogo M9 ni activa USD, unidades fraccionarias o sincronización Woo.

## Entorno y evidencia

Supabase local nuevo `mi-tienda-october-auth-20261009`, API59321/DB59322, con Auth y PostgREST reales. No se reutilizó ni reinició ninguno de los tres entornos anteriores o el staging M9 alojado. Los únicos reinicios fueron del entorno nuevo exclusivo para las corridas de QA. Datos de prueba ficticios, correos `.test` y respuesta de conservación identificada como sintética; no se usan respuestas inventadas para migrar productos.

Ensayo incremental125→126: las cuatro definiciones de funciones que modifica el SQL coinciden exactamente con las alojadas en principal. Aplicación de la nueva migración conserva huellas y cantidades de92tablas existentes, incluidas identidades, saldos, movimientos, documentos y respuesta ficticia. `sale_payments` se compara excluyendo únicamente la nueva columna nullable `card_kind`. Evidencia externa al repositorio: `outputs/m9-publicacion-operativa-2026-10-09/upgrade-preservation.json`. Script `scripts/verify-october-upgrade.mjs` admite exclusivamente el puerto local de este QA.

Pruebas nuevas `october-acceptance.test.ts`, mediante usuarios y JWT emitidos por Auth real y llamadas RPC PostgREST:

- Alta de cliente y categoría; rechazo por rol.
- Entradas idempotentes, base desactualizada y dos entradas concurrentes.
- Aislamiento entre sucursales y acceso directo prohibido a libros.
- Venta crédito/débito, repetición, dos devoluciones parciales con suma exacta, exceso rechazado e identidad documental conservada.
- Cancelación de tarjetas combinadas; segundo intento rechazado sin volver a restituir stock.
- Dos cajas, turno abierto, faltante, corte consolidado y repetición sin duplicarlo.
- Avisos/acuse, valorización y USD apagado.

152unitarias, tipos, lint y build pasaron en la candidata integrada.39recorridos de navegador pasaron en5940. Estos últimos usan el modo de demostración y simulación del alta de cliente; la aceptación de permisos y dinero está comprobada por los RPC reales anteriores. No se presenta como aceptación física de Safari, audibilidad, banco o impresión.

## Correcciones del arnés de pruebas

La primera ejecución nueva tenía un código de sucursal en minúsculas y utilizaba `p_kind` en vez de `p_document_type`; se corrigieron las fixtures. La prueba de cancelación repetida ahora espera el rechazo contractual `SALE_NOT_CANCELLABLE`, conservando stock.

La suite M9 existente usaba hashes de fuente constantes entre ejecuciones y medía inventario global mientras otras suites vendían. Sus fuentes de prueba ahora incorporan el identificador de corrida (con repetición estable dentro de la misma corrida), y su comprobación de existencias se limita a sus propios códigos. Sigue comprobando ceros iniciales, importación idempotente y cero inventario para productos importados. No se cambia el importador. Las demás fixtures históricas requieren base limpia porque tienen teléfonos, etiquetas y límites por origen constantes.

Se corrigió formato de `tests/e2e/pos.spec.ts` para la compuerta CI. Se conserva la lógica financiera de la entrega e3d827e. La prueba adicional con navegador real detectó y corrigió una comparación de origen incorrecta en las dos rutas POST nuevas: se compara ahora con Host y protocolo externo, no con la URL interna de Next. Se rechazan orígenes externos, ausentes o malformados y no se confía en x-forwarded-host;14casos nuevos cubren estas condiciones.

La publicación requiere cerrar la corrida limpia completa y los controles remotos. No aplicar datos de prueba al principal; verificar el esquema y los documentos mediante sólo lectura después de la migración. Prueba física de sonido y Safari queda para los dispositivos de tienda.

Cierre local: reconstrucción limpia de126migraciones y178pruebas de integración en18archivos aprobadas, incluida la nueva aceptación7casos. La corrección M9 también pasó sus4casos aislados. Formato completo correcto. Registros `final-reset.log`, `final-integration.log`, `m9-isolated.log` y `browser.log` en la carpeta de evidencia. Pendiente únicamente el cierre de publicación remota y verificación del principal; no se mezclan estas pruebas locales con pruebas físicas.

Aceptación adicional navegador→servidor→Auth→PostgREST: login real, alta de categoría persistida, origen externo rechazado y usuario sin sesión redirigido sin crear datos. Resultado PASS en `browser-real-auth.json`, captura `browser-real-auth.png`. La corrección de origen suma152unitarias aprobadas.
