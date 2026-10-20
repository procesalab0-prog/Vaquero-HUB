# Apertura de saldos heredados y ensayo de abonos

20 octubre 2026. Sólo staging `zsezjtswqeijboezvado` y Preview M9. No producción,
main, SICAR ni Woo. Diseño: libro privado asociado al UUID heredado existente,
sin crear clientes nativos con teléfonos o consentimientos inventados. No ventas
retroactivas, autorizaciones de crédito nuevo, cobros históricos ni entregas.

## Plan y límites

Abrir exclusivamente los siete documentos OPEN de seis cuentas del lote real
APARTADO, por 1,191,000 centavos ($11,910). Los 66 documentos pagados permanecen
archivo. Los siete abonos históricos activos ($4,200) y el cancelado ($1,000)
no se recrean como dinero recibido. Las fuentes sintéticas de QA se excluyen por
lote/alcance, nunca por nombre. Este corte no representa todos los clientes SICAR.

El preparador `scripts/m9/prepare-legacy-finance.mjs` exige plan SHA256 fijado,
actor/request/ubicación explícitos, sumas y abonos conciliados. No lee secretos,
no usa red y no ejecuta SQL. Genera apertura, ensayo de compensación y resumen;
dos corridas idénticas. En base se exige staging/ADMIN/customers.manage y
credit.collect, vigencia <24h del corte, fuente/hash sin cambiar y Default→La
Piedad confirmado. La apertura conserva vencimientos y documento exacto.

Tres tablas privadas append-only con RLS, sin grants de datos a la aplicación:
`app.m9_legacy_finance_events`, `app.m9_legacy_finance_ledger` y
`app.m9_legacy_finance_allocations`. Reintento por UUID+hash+actor, bloqueo
transaccional y unicidad de documento. Compensación auditable antes de pagos,
rechazada si hay abonos o compensación previa. Un trigger impide abrir después
la misma deuda en el libro nativo; un eventual traslado requerirá su plan propio.

## Abonos: ensayo, todavía sin cobro operativo

Ruta `/clientes/heredados-sicar/saldos`, enlazada desde el registro heredado.
Lista la apertura y permite introducir un importe ficticio de prueba. RPC público
invoker → dispatcher privado con JWT ADMIN y credit.collect. Aplica el importe
por vencimiento/clave de documento, comprueba el reintento dentro de la misma
transacción y revierte mediante subtransacción. Sólo conserva evidencia TRIAL;
los cargos, asignaciones y saldo operativo no cambian. No emite recibo válido,
no atribuye método de pago y no crea efectivo o folios de caja.

El núcleo no es una API de cobro: no es ejecutable por authenticated y exige
modo TRIAL interno. La ruta es sólo Preview y ningún endpoint permite confirmar
un pago real. El siguiente bloque debe integrar caja, métodos, recibo y corte,
con conciliación sin duplicados, antes de cobrar abonos operativos. No presentar
este ensayo como aceptación completa de caja o de toda la migración.

## Resultados verificados de base y código

Migraciones `20261020214800` y `20261020214952`: la segunda corrige alias de
variables detectados durante el primer ensayo fallido, revertido sin datos.
No se reescribe la migración aplicada. Ensayo final: apertura 7/6/$11,910,
liquidación de las seis cuentas, abono parcial de $5,000 repartido $4,700/$300,
replay y compensación a cero. Once negativos financieros + seis de preflight
(plan cambiado, ubicación inválida, corte inexistente, sin actor, mantenimiento
por authenticated y anon). PASS y ROLLBACK: 135 tablas idénticas.

Conservación posterior sólo staging: siete cargos de apertura y un evento OPEN;
ningún abono ficticio persistente. Cambian exclusivamente dos tablas nuevas;
las 132 anteriores permanecen idénticas. Caja, ventas, inventario, consentimiento,
clientes nativos y fuentes SICAR intactos. Replay de apertura sin nueva entrada.
960 pruebas unitarias/114 archivos, TypeScript, ESLint, Prettier y diff-check PASS.

Evidencia privada fuera de Git: `outputs/m9-apertura-saldos-heredados-2026-10-20/`.
Incluye plan fijado, generador/configuración, ensayos SQL, resultados y hashes.
Aceptación de Preview y comprobaciones finales se registran después del despliegue.

## Preview y aceptación con sesión real

Deployment `dpl_BWd3q72qXnUx9pQdFN7TFuA9MQtC` READY, commit Preview
`ca3850de3bb43fb718ff87618888b85ed11dd995`, target null. Migración adicional
`20261020215259` muestra al actor su último ensayo auditado. Pantalla comprobada
con la sesión real de Emmanuel: seis cuentas/siete documentos/$11,910 y acceso
por enlace desde el registro heredado.

Tres ensayos aceptados desde UI: $1 sobre $600; $5,000 sobre $7,940 repartido
$4,700 y $300 entre dos documentos; liquidación de $240 sobre una cuenta sin
telefono. Rechazo de $600.01 sobre $600. El saldo simulado se distingue del
conservado; reload mantiene evidencia y $11,910. La repetición verificada es la
del núcleo dentro del ensayo; no se afirma replay HTTP idéntico desde navegador.

Auditoría antes/después de la UI en 135 tablas: cambia únicamente
app.m9_legacy_finance_events, con tres eventos TRIAL. Siete cargos OPEN intactos;
cero PAYMENT_TRIAL o asignaciones persistentes, un cliente nativo y cero libro
nativo. Las 36 cantidades de conteo/compromisos del piloto siguen NULL. No caja,
inventario, ventas, source ni consentimientos alterados. Compensación de la
apertura persistida probada nuevamente con rollback: siete compensaciones,
saldo cero dentro de la transacción, restaurado después.

Vista de 390×844: scrollWidth=clientWidth=390, seis formularios y botones de
341×44 px. Capturas escritorio/teléfono conservadas; viewport restaurado.
Advisors: 79 INFO RLS sin policy (tres nuevas tablas deliberadamente privadas),
131 WARN definer authenticated y una WARN Auth preexistentes sin incremento.
No se consultaron logs remotos: el conector tenía limitación conocida de acceso;
no se declara revisión de logs sin errores.

Este bloque cierra apertura y ensayo de abonos heredados. Sigue aceptar el
cobro real de staging junto con caja, métodos y recibos, corte completo de todos
los clientes/documentos y evidencia de entregas/conteos. Nada se habilita en
producción por terminar este ensayo. Las filas de preparación de inventario
no se convierten en stock y las entregas UNKNOWN no se tratan como entregadas.
