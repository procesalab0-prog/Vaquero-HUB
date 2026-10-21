# Cobro operativo heredado y renovación de corte · staging

20 octubre 2026, hora de México. Continuación de
[M9_ABONOS_HEREDADOS_CAJA_RECIBOS_STAGING.md](M9_ABONOS_HEREDADOS_CAJA_RECIBOS_STAGING.md).
Autorizado preparar y probar en staging; no producción, main, SICAR/Woo ni
abonos reales. No activar por el simple hecho de pasar un ensayo.

## Fuente renovada y alcance

Tras recuperar la sesión SICAR se volvió a recorrer el listado APARTADO hasta
61 cuentas, sin carga pendiente; seis cuentas con deuda y siete documentos
abiertos se consultaron con navegación completa antes de leer detalle y abonos.
Se compararon IDs de cliente/documento, folios, importes, vencimientos y los ocho
abonos vinculados. Coinciden con la apertura: $11,910 pendientes, $4,200 históricos
activos y $1,000 cancelados excluidos. No son pagos nuevos.

Corte conservador del nuevo conjunto: 2026-10-21T02:22:00.689Z
(20 octubre, 20:22:00 México). No se cambió el source_at del lote original.
Es renovación de documentos abiertos del alcance APARTADO, no renovación completa
de todos los clientes, créditos, ventas o entregas. No demuestra conteos físicos.

Generador scripts/m9/prepare-legacy-operating.mjs fija cinco archivos por SHA256:
plan fuente, registro heredado, seis cuentas, siete detalles y listado final.
Rechaza fuente vencida/futura, lista incompleta, detalle sin recarga completa,
cambio de vencimiento, saldo/abono cancelado o referencia heredada ausente.
Produce payload normalizado, resumen, registro idempotente y ensayo ROLLBACK.
Tres corridas idénticas byte a byte. Fechas de la interfaz se interpretan con el
parser ya verificado de SICAR; se probó también la leyenda «Venció el».

La renovación sólo se registra si el plan financiero actual, las aperturas,
cuentas, documentos y abonos coinciden exactamente. No reemplaza saldos ni convierte
TRIAL en pagos. Un único corte nuevo se conservó en tabla privada inmutable;
reintento devuelve el mismo corte sin cambiar su fecha.

## Plan operativo y bloqueos

Migración 20261021023011 aplicada únicamente en staging zsezjtswqeijboezvado.
Tres tablas privadas: cortes, ventanas y revocaciones; RLS sin grants de datos.
Eventos inmutables, FK/indexes y funciones con search_path vacío.
No claves privilegiadas en cliente. API exige ADMIN/customers.manage/credit.collect.

Motor separado de los ensayos anteriores: pago PAYMENT negativo, asignación FIFO,
recibo inmutable, referencia M9_LEGACY_PAYMENT y sólo efectivo aplicado a caja.
Conserva folios SICAR, métodos, recibido/cambio y hash de solicitud. Reintentos
idénticos no duplican deuda, caja o folio; una solicitud modificada se rechaza.
No se conecta banco ni terminal, no crea ventas ni acredita entregas.

COLLECT exige ventana OPERATING del mismo usuario, sucursal, cuenta aprobada,
caja abierta propia y fuente sin cambios. Cada nueva recepción exige fuente de
máximo 30 minutos; ventana de máximo 15 minutos, revocable por evento.
Una ventana REHEARSAL nunca sirve para COLLECT. Corte o ventana vencidos,
revocación, apertura compensada, sobrepago o método/referencia inválidos bloquean.

Activación sólo por mantenimiento privado y con evidencia de autorización humana,
corte confirmado y un solo sistema registrando abonos. No hay botón de activación
en Preview, ni se fabricó esa autorización. Cero ventanas operativas persistentes.
La preparación de estas funciones no equivale a aceptación de un cobro real.

Antes de activar falta cerrar el procedimiento de anulación/compensación de un
pago realmente recibido y su recibo operativo, renovar nuevamente SICAR y acordar
el cambio de sistema. Los recibos actuales siguen siendo exclusivamente de ensayo.
No convertir una evidencia de ensayo ni su UUID en abono real.

## Ensayo del mismo motor, rollback y auditoría

REHEARSE crea una ventana QA transitoria sin aprobación humana, ejecuta el motor
operativo y su replay dentro de subtransacción, comprueba diferencia de efectivo,
y revierte ventana, PAYMENT, asignaciones, recibo, movimiento, folio/tipo y audit.
Compara libro/caja/contador antes y después. Guarda sólo evidencia en la tabla
existente m9_legacy_cash_trials, marcada ENSAYO REVERTIDO / NO VÁLIDO COMO PAGO.

26 rechazos SQL comprobados: 12 de cobro/formato/métodos/sin autorización,
siete de corte cambiado/vencido/futuro/inmutable, cuatro de ventana QA pública,
revocada o vencida, y tres de cuenta/sesión fuera de alcance y replay modificado.
Además ocho comprobaciones ACL denegadas para acceso directo/anon/mantenimiento.
El ensayo positivo incluyó FIFO sobre dos documentos y reintento idéntico.

Auditoría de 140 tablas: todas idénticas tras los ensayos SQL con ROLLBACK.
Después del registro real de evidencia sólo cambia m9_legacy_operating_cuts.
Después de UI sólo cambia m9_legacy_cash_trials (dos evidencias nuevas).
Cero ventanas, PAYMENT, recibos del motor o movimientos de caja persistentes.
$11,910 conservados; caja sigue OPEN, cliente nativo único sin cambios.
No stock, reservas, conteos, entregas ni consentimiento inventados.

973 pruebas unitarias / 116 archivos PASS, tipos, ESLint, Prettier y diff-check.
Advisors: 84 INFO RLS sin policy (tres tablas nuevas privadas deliberadamente);
131 WARN definer y una WARN Auth anteriores, sin incremento de advertencias.
Referencia de INFO privado:
https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy.
No se declara saneamiento de advertencias previas.

## Aceptación publicada y con sesión real

Preview READY dpl_2E7V3CfUBTBCtoF7FBvpUgUJ64nt, target null, commit
15764fced2dadd9990a536897bd5f8ec2e902c1c, rama codex/m9-staging-review.
Árbol igual al commit local ffe8a97. No push a main ni promoción de producción.

Ruta /clientes/heredados-sicar/caja muestra fecha, alcance parcial, seis cuentas,
siete documentos, saldo y cero ventanas. Si el corte vence para ensayo, deshabilita
el formulario y el servidor vuelve a validar su vigencia. La activación tiene
vigencia más corta y requiere renovar fuente, no editar su fecha.
Consultas independientes paralelas; acciones autorizadas en servidor; sin nuevos
hooks ni datos sensibles publicados en Git.

Sesión real Emmanuel ADMIN: combinado $5,000 ($100 efectivo, recibido $150,
cambio $50; $2,000 tarjeta y $2,900 transferencia), FIFO $4,700/$300 sobre
VSM6907/VSM6912 y saldo $7,940 conservado. Liquidación simulada de $240 de una
cuenta sin teléfono: cambio $60, saldo simulado cero, conservado $240. Rechazo
de $600.01 frente a $600 confirmado desde UI. Recibos muestran motor operativo
y corte renovado, siempre ENSAYO y sin valor como pago.

Móvil 390×844: formulario y recibo scrollWidth=clientWidth=390; botón final44px,
bottom664 dentro del viewport y encima del menú; viewport restaurado.
No se imprimió físicamente ni se recibió dinero. No se afirma aceptación de
anulación de pago real ni revisión completa de runtime logs.

Evidencia privada fuera de Git:
outputs/m9-cobro-operativo-renovacion-2026-10-20/.
Incluye capturas/texto de SICAR, pins, tres corridas, SQL ROLLBACK, auditorías,
capturas de Preview y comprobaciones de recibo/errores.

## Orden del siguiente bloque

1. Completar padrón y documentos fuera del filtro APARTADO, manteniendo IDs de
origen y sin duplicar cuentas por nombre.
2. Acreditar entregas pendientes y conteo físico de los doce códigos del piloto.
Sus 36 cantidades siguen NULL; no equivale a cero ni permite importar stock.
3. Aceptar recibo operativo y anulación/compensación con caja en ensayo; después
renovar corte, acordar único registro de abonos y autorizar arranque limitado.
4. Sólo con corte final conciliado y aprobación separada preparar producción.

La cobertura de catálogo documentada sigue 96.92%; no es porcentaje total de
migración. Este bloque cierra renovación parcial y preparación/ensayo operativo.
No declara terminada toda la migración ni habilita cobros reales.

