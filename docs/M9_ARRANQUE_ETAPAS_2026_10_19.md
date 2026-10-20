# M9 · Preparación y ensayo del arranque por etapas

## Alcance y resultado

Bloque autorizado por Emmanuel: avanzar todo lo posible sin tocar producción.
Se preparó el catálogo completo para un arranque progresivo y se ensayaron sus
listas de venta en staging. No se activa una etapa permanente, importa saldo,
archiva producto, cambia agrupación ni escribe en Woo/main/producción.

La captura del 19 de octubre de México (2026-10-20T01:32:35Z) contiene 15,876
códigos SICAR únicos, sin diferencias entre proyección viva y fila registrada.
La comparación de 18 tablas fue idéntica al principio, tras capturar y después
de los ensayos. Se conserva el historial: dos ventas, una devolución, ocho
movimientos de inventario y caja neta previamente cerrada a cero.

| Etapa propuesta | Códigos nuevos de la etapa | Acumulado | Lotes preparados |
| --- | ---: | ---: | ---: |
| Revisión anterior conservada | 7,776 | 7,776 | 32 |
| Regla técnica T. autorizada sólo para staging | 823 | 8,599 | 4 |
| Provisionales independientes, sin publicación Woo | 7,243 | 15,842 | 29 |
| Retenidos, fuera de todos los lotes | 468 | — | — |

Los 468 retenidos son 34 códigos ya cargados pero sin revisión de venta, más
434 todavía no cargados. No son 468 nuevos errores ni 468 preguntas nuevas.
La carga SICAR sigue en 15,876/16,310 (97.3391%); el bloque aumenta preparación
operativa, no cobertura. Tampoco equivale a completar toda M9.

## Preparador reproducible

`scripts/m9/prepare-phased-launch.mjs` es offline, sin cliente de base de datos,
red, SQL de carga ni modo productivo. Fija por SHA256 filas SICAR, manifiesto,
captura completa de staging, conjunto de la regla y autorización/muestra.
Revalida la regla existente mediante `authorizeRule`; no inventa respuestas de
dueños ni convierte una autorización técnica en aprobación comercial.

Cada código de fuente aparece una sola vez. Conserva Clave 1 literal, variant_id
y product_id. Compara descripción SICAR, precio1, departamento y sección; exige
proyección aplicada intacta, vínculo real del código, unidad PIECE y producto
activo. Rechaza código numérico/duplicado, UUID repetido, captura parcial o de
otro proyecto, revisión deshabilitada y captura fuera de la fecha fijada.
Cambios de precio, revisión, clasificación, unidad o identidad quedan retenidos;
no se corrigen sobrescribiendo. Si una familia de la regla cambia, sus restantes
miembros no se liberan alrededor de la anomalía. Ausentes del nuevo corte se
conservan para revisión: no implican baja.

Los lotes de hasta 250 códigos tienen huella individual de identidad; no cambian
padres ni agrupan provisionales. La plantilla genera 15,842 combinaciones
código/sucursal de tienda, todas con cantidad, reserva, fecha, evidencia y
responsable NULL. No incluye tránsito ni copia la columna existencia de SICAR.
El alcance de ubicaciones sigue sin confirmar; ausencia nunca significa cero.
La plantilla JSON es de revisión, no es aceptada por un importador de saldos.
Los costos desconocidos permanecen NULL y no se define mayoreo.

Se conservan las retenciones comerciales anteriores; los motivos del reporte
no sustituyen las preguntas existentes ni publican otra tanda de consultas.

Dos corridas del corte real generan los mismos seis archivos y manifiesto:
plan.json, resumen.json, pendientes.json, lotes.json, plantilla-existencias.json,
reporte.html y sha256.json. Rechaza entradas alteradas y salida existente.
El HTML escapa los textos y muestra resumen y ejemplos; el detalle permanece
local, fuera de GitHub.

## Ensayos de las tres etapas en staging

`scripts/m9/phased-guard-rehearsal.mjs` produce sólo tres scripts de ROLLBACK.
Cada script verifica las 18 huellas de la base capturada, toma bloqueo de las
tablas privadas de revisión y comprueba código/variant_id/proyección de todos
los miembros. Luego simula una revisión vigente para el acumulado de esa etapa.

PASS: 7,776, 8,599 y 15,842 miembros permitidos respectivamente dentro de cada
transacción, todos los demás gestionados bloqueados. Diez controles por etapa
(30 en total) incluyen rechazo de producto rápido y UUID desconocido, filtro
del catálogo POS con actor de sesión ADMIN real, invalidación de revisión
alterada, caducidad y ausencia de permisos de activación para clientes. El actor
JWT de estas consultas es un fixture SQL de mantenimiento: no es otra prueba
de PIN ni de interfaz Auth/PostgREST. Los flujos reales de cobro/devolución se
probaron en el bloque anterior y se conserva su evidencia.

No se crearon ventas, devoluciones, conteos, traspasos ni ajustes en este ensayo.
No se deshabilitaron restricciones ni compuertas. Al finalizar cada script se
revierte la revisión simulada. Auditoría final idéntica: control habilitado,
revisión real vencida, cero filas de la lista con su SHA vigente y físico y
reservado cero. La variante no M9 también devuelve M9_REVIEW_EXPIRED. No se
borraron movimientos ni se reejecutó ningún cierre antiguo.

PASS: 740 pruebas unitarias/101 archivos (18 nuevas), ESLint dirigido y
TypeScript. No hay migración de esquema nueva ni cambio de aplicación web en
este bloque. Los ensayos son SQL de mantenimiento en staging; no se afirma
haber operado las tres etapas desde el navegador ni con existencias reales.

## Reproducción y reversión

Desde la copia de trabajo M9, con un directorio de salida nuevo:

```text
node scripts/m9/prepare-phased-launch.mjs CONFIG_FIJADA.json SALIDA_NUEVA
node scripts/m9/phased-guard-rehearsal.mjs SALIDA_NUEVA/plan.json SNAPSHOT.json SQL_NUEVO
```

Repetir el primer comando a otra salida y comparar sha256.json. Antes de ejecutar
cualquier ensayo, comprobar proyecto, fuentes, fecha, todas las identidades y
huellas actuales. Los scripts terminan en ROLLBACK; si falla una comprobación,
no se continúa ni se transforma el script en COMMIT. Una captura alterada o
actividad concurrente requiere regenerar el expediente, nunca borrar historia
para satisfacer los controles de una herramienta vieja.

La reversión de este bloque es el propio rollback; no existe una carga guardada
que retirar. Los paquetes locales pueden archivarse como evidencia sin tocar
el catálogo. No se generó un aplicador de producción ni un script de borrado.

Evidencia en outputs/m9-arranque-etapas-2026-10-19/ del workspace exterior:
config.json, staging-snapshot.json, auditoria-antes/final.json, corridas 1/2,
ensayos-guardas/, ensayos-resultado.json, unitarias.log y resultado.json.

## Lo necesario antes del arranque real

1. Exportar otra vez SICAR y Woo autenticado, completos y del corte acordado.
   Este expediente usa el corte histórico del 12 de octubre; no lo presenta
   como actualizado hoy. Repetir análisis y proteger cambios de destino.
2. Confirmar todas las sucursales/almacenes y obtener existencias y reservas
   reales por código y ubicación, con fecha y responsable. Ensayar su carga
   con libro, idempotencia y reversión específicos; este bloque no la implementa.
3. Elegir un piloto pequeño dentro de los códigos revisados y comprobar lector,
   cobro, devolución, caja y movimientos junto a SICAR. Después ampliar por los
   lotes, sólo si coincide la conciliación. Agrupar provisionales puede esperar;
   su asociación Woo no se supone y permanece bloqueada.
4. Verificar respaldo/restauración del destino real, corte de operaciones,
   pedidos Woo pendientes y autorización expresa de producción. No activar
   sincronización de pedidos/existencias por considerar listo el catálogo.

No se puede archivar por inactividad todavía: faltan reportes completos de
existencias por ubicación, ventas con devoluciones/cancelaciones distinguibles,
compromisos y pedidos Woo abiertos. Ese trabajo sigue separado de poder cargar
catálogo y no frena las pruebas con lo ya confirmado.
