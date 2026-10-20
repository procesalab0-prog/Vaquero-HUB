# M9: importador de cuentas de origen y apertura de crédito

Diseño previo al cambio, 20 octubre 2026. Autorización de Emmanuel: construir
el importador, usar lo confirmado y probar el lote en staging sin producción.

## Decisión y alcance

No cambiar las restricciones de consentimiento/teléfono de public.customers.
Las 61 identidades SICAR se importan en un registro privado de origen, separado
de socios, Auth y marketing. No fusionar por nombre o teléfono, incluso cuando
coincidan. Conservar documentos pagados, siete saldos abiertos por $11,910,
abonos cancelados/activos y 99 líneas con Clave 1 literal. Entrega UNKNOWN no
se convierte en reserva ni salida de inventario.

El importador será de mantenimiento, privado en app, SECURITY INVOKER, sin
permisos a anon, authenticated o service_role. Verificará staging, actor ADMIN,
integridad del lote, caducidad del corte y coincidencia del payload al repetir.
Se habilitará RLS sin políticas de aplicación en las nuevas tablas privadas.
Los hashes de entrada y el recibo permiten repetir el mismo lote sin duplicar;
un payload cambiado debe rechazarse. Un corte posterior requiere conciliación
explícita, no sobrescritura de saldos históricos.

## Puente operativo y reversión

La apertura nativa exige un vínculo individual revisado con un cliente ya
válido de Mi Tienda, evidencia y ausencia de deuda previa en el destino del
piloto. No crear clientes, consentimientos o cuentas Auth para pasar esa prueba.
Sólo crear CHARGE por el saldo pendiente de cada documento con vencimiento
observado y referencia SICAR; no recrear ventas ni ingresos históricos de caja.
No abrir crédito nuevo ni copiar un límite autorizado a partir del saldo usado.

La reversión será compensatoria, sin borrar el libro: CANCELLATION y asignación
al cargo original. Rechazar si ya hubo abonos, cambios o asignaciones al cargo.
Esto evita que un cargo revertido siga recibiendo abonos por FIFO. Los eventos
de apertura/reversión son auditados y los reintentos no agregan movimientos.

## Ensayos requeridos

1. Instalar esquema sólo en staging y verificar privilegios/RLS/advisors.
2. Ensayar el lote real y su repetición en transacción con rollback: 61 cuentas,
   73 documentos, ocho antecedentes de abono, 99 líneas, deuda $11,910.
3. Probar puente nativo con identidad sintética claramente marcada y cliente
   preexistente como fixture técnico, nunca vincular identidades SICAR reales
   sin revisión. Apertura, cobro parcial, reintento y sobrepago; rollback.
4. Probar reversión compensatoria antes de cobrar y rechazo después de cobrar.
5. Comparar todas las tablas anteriores y las nuevas. Cualquier carga que
   permanezca en staging se identificará como registro de origen pendiente;
   no anunciar clientes operativos, saldos nativos o aceptación Auth real.

Datos personales y SQL del lote fuera de Git. Documentar resultados, límites
y reproducción al terminar. Sin main, despliegue de producción o escrituras
SICAR/Woo. No agregar preguntas individuales a los dueños en esta etapa.

## Resultado verificado

Instaladas cuatro migraciones nuevas exclusivamente en staging: fundación,
corrección del recibo, sucursal explícita y corrección del alias de reversión.
Se conservaron sin modificar los SQL ya aplicados. Los archivos fueron creados
por CLI y alineados con las versiones efectivamente registradas por MCP:
`20261020153451`, `20261020153623`, `20261020154010`, `20261020154109`.
Los ensayos detectaron y corrigieron resolución de nombres del recibo/alias y
la exigencia NOT NULL de location_id en el libro. Ningún intento fallido dejó
datos parciales. La apertura exige Default confirmado, sucursal STORE accesible,
corte confirmado y lote de menos de 24 horas; la compensación conserva sucursal.

El importador permanente privado se probó con el lote real completo: 61 cuentas,
73 documentos, ocho antecedentes de abono y 99 líneas; $11,910 de deuda de origen.
Repetición exacta sin duplicado. Doce negativos PASS: diferencias por cuenta,
consentimiento inventado, autorización de inventario, entrega supuesta, abono
descuadrado, total inconsistente, cambio de payload, colisión de otro corte,
actor ausente y llamadas de authenticated/anon/service_role. Rollback integral.

Puente nativo probado con **identidad sintética**, sin vincular las cuentas SICAR
reales al fixture. Dos cargos por $10.00, abonos de $4.00/$6.00, FIFO, reintento
sin duplicados y siete negativos PASS: ubicación no revisada, corte vencido,
identidad no confirmada, vínculo duplicado, cambio de evidencia, reversión
después de abonar y sobrepago. Reversión compensatoria antes de cobrar deja
saldo y cargos pendientes FIFO en cero; repetición de reversión sin duplicados.
Rollback completo de escenarios nativos. No prueba Auth/PostgREST real ni UI.

**126 tablas idénticas antes/después de los ensayos con rollback.** Después se
cargó y conservó el lote real sólo en las cinco tablas privadas de datos de origen;
la sexta tabla, eventos de apertura, sigue vacía. Cambió además una entrada de
audit_log para documentar la carga. Las otras 119 tablas anteriores permanecen
idénticas, incluido el único cliente nativo existente, libro de crédito vacío,
dos ventas, una devolución, cinco movimientos de caja y ocho de inventario.
La repetición de la carga persistente dejó las 126 tablas idénticas al primer
resultado: tampoco duplicó la auditoría. **No hay nuevos socios ni deudas nativas
reales activadas.** Todos los target_customer_id de origen permanecen NULL.

Retiro del lote de origen ensayado con rollback: retira 61 cuentas y su lote,
conserva auditoría, no toca el libro nativo; al revertir el ensayo quedan las
61 cuentas cargadas. El script rechaza retirar un lote con vínculos o aperturas,
incluso si éstas fueron compensadas: el historial financiero requiere conservar
sus referencias. No se publica un botón para borrarlo ni se ejecuta el retiro
con COMMIT automáticamente.

929 unitarias / 109 archivos, ESLint, Prettier y TypeScript PASS. Cuatro funciones
SECURITY INVOKER con EXECUTE denegado a anon/authenticated/service_role, seis
tablas privadas con RLS y sin permisos de aplicación. Advisors: ninguna nueva
advertencia WARN; seis INFO nuevos por RLS sin políticas son deliberados para
estas tablas sin acceso de aplicación. Ver
[regla de RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
Las advertencias previas del proyecto no se declaran resueltas por este cambio.

## Reproducción y límites

1. `scripts/m9/import-customer-sources.mjs CONFIG_FIJADA.json DIRECTORIO_NUEVO ACTOR_STAGING_UUID`
   reconstruye la revisión desde seis entradas fijadas por SHA256. No conecta
   a Supabase. Genera ensayo con ROLLBACK, carga privada de staging con COMMIT,
   ensayo de retiro y retiro explícito; manifiestos con hashes de cada archivo.
2. `scripts/m9/rehearse-customer-import.mjs` genera los ensayos completos desde
   snapshot de 126 tablas y fixture válida, comprobados antes de cualquier acción.
   El snapshot debe tener menos de una hora; no se reutiliza una instantánea vencida.
3. El plan real tiene SHA256
   `c19da9627d6536e0f39bd58c5029e8d8627a35f5f4bd0f99118f3ceb46a759f9`.
   Planes, nombres, contactos, SQL y comprobantes privados permanecen fuera de Git
   en `outputs/m9-importador-clientes-saldos-2026-10-20/` del workspace raíz.

La carga privada es una copia del corte observado, no sincronización en vivo.
Otro corte cambiado se rechaza y requiere conciliación explícita; todavía no
existe un actualizador automático de saldos. El alcance sigue siendo APARTADO,
no todo el padrón SICAR. Los 11 teléfonos faltantes, dos nombres repetidos y
cinco líneas sin variante única siguen en revisión. Las 99 entregas siguen
UNKNOWN y los documentos pagados no se presumen entregados. No crear apartados
nativos, reservas, salidas ni puntos de lealtad a partir de esta copia.

Siguiente bloque: pantalla administrativa de revisión del origen, padrón completo
y vínculo de identidades con evidencia individual; luego aceptación de abonos
desde Preview con Auth real. El puente sólo admite actualmente un destino nativo
válido, con consentimiento registrado, teléfono coincidente revisado y libro vacío;
no permite fusionar clientes ni eludir esos controles. Antes del arranque se debe
renovar y conciliar el corte porque SICAR continúa operando. Sin main/producción.
