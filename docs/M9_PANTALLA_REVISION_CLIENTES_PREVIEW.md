# Revisión de clientes SICAR y ensayo con Auth real

Diseño previo al cambio, 20 octubre 2026. Solicitud: pantalla de revisión y
prueba de vínculos/abonos desde Preview, sin producción.

Ruta de staging `/clientes/migracion-sicar`: resumen, búsqueda paginada,
documentos, abonos de origen/cancelaciones, líneas y entregas UNKNOWN. Sólo
ADMIN con customers.manage y autenticación vigente; no habilitar acceso por
ser simplemente authenticated. Tablas fuente siguen privadas sin grants.

RPC público SECURITY INVOKER delega a un dispatcher privado SECURITY DEFINER
con search_path vacío, comprobación explícita auth.uid/ADMIN/permisos/staging,
acciones cerradas y límites. No publica el importador de mantenimiento. La
interfaz puede guardar revisión pendiente/candidato, sin activar deuda real,
fusionar clientes ni registrar consentimiento. Los candidatos por teléfono
son sugerencias; nombre similar no aprueba identidad.

Para aceptar el flujo desde navegador, usar una fuente **SYNTHETIC_QA_NOT_SICAR**,
el cliente nativo preexistente como fixture y caja abierta del actor. Una
ventana privada temporal fija actor, fuente, destino y vencimiento. No crear
clientes ni consentimiento ficticio ni dar crédito nuevo.

El ensayo conserva únicamente su estado y comprobación en una tabla privada.
Cada acción reconstruye apertura y abonos previos dentro de una subtransacción,
llama al puente/RPC nativos, captura resultado y revierte esa subtransacción
antes de devolver. Así se prueba Auth → server action → PostgREST → libro/caja
nativos → respuesta/UI sin dejar cobros ni deuda sintéticos en las tablas
operativas. No emitir ticket válido, enviar correos ni presentar los resultados
de ensayo como abonos persistentes. Reintento con el mismo UUID devuelve el
mismo resultado; payload distinto debe fallar. Concurrencia bloquea por ensayo.

Probar consulta real, cuenta sin candidato, navegación/paginación, vínculo de
ensayo, abonos $4/$6 sobre $10, sobrepago, reintento y saldo cero, con sesión
real en Preview. Verificar auditoría de tablas operativas y las 61 cuentas
reales antes/después; cerrar ventana de ensayo al terminar. Fuera de Preview,
sin sesión o rol correcto: denegado. Main, SICAR, Woo y producción intactos.

## Resultado verificado con sesión real

Ruta publicada exclusivamente en `codex/m9-staging-review`, backend staging
`zsezjtswqeijboezvado`. Sesión de Emmanuel existente en Preview, sin extraer
cookies/JWT ni usar una clave privilegiada desde el navegador. La pantalla
consultó 61 cuentas y $11,910, búsqueda sin coincidencia, página dos con 20
cuentas y detalle con abono cancelado excluido/entrega desconocida. No se
guardaron revisiones ficticias ni vínculos de identidades SICAR reales.

Flujo limpio desde navegador: vínculo sintético por $10, abono de $4, saldo $6,
abono de $6 y saldo $0; dos abonos comprobados en el estado privado del ensayo.
El flujo pasó por server actions, Supabase SSR/PostgREST, autenticación real y
los procedimientos nativos de apertura/cobro dentro de subtransacciones.
**No son cobros persistentes ni comprobantes válidos.** Sobrepago $11 rechazado.

Se hizo además un primer ensayo de navegación atrás/reenvío: terminó con tres
abonos sintéticos $4/$4/$2. La comprobación de reintento idéntico desde caché
del navegador fue inconclusa y no se cuenta como prueba de idempotencia real.
Una solicitud modificada fue rechazada como conflicto; un abono de $6 cuando
restaban $2 fue rechazado como sobrepago. Ambos ensayos terminaron en cero.
La idempotencia exacta se verificó por separado con rol authenticated en una
transacción SQL: mismo UUID/payload devuelve replay sin repetir pago; payload
distinto rechazado. No declarar esa prueba SQL como navegador/Auth real.

Seis negativos de acceso/integridad PASS: sin actor, actor no registrado como
personal, anon, candidato sin identidad coincidente, payload de reintento
cambiado y sobrepago. No había fixture de empleado activo no ADMIN; no se
inventó uno ni se afirma una aceptación de ese rol. Las comprobaciones
explícitas ADMIN y customers.manage/credit.collect permanecen en servidor/DB.

Auditoría: **129 tablas**, 128 idénticas después de las acciones del navegador;
sólo cambia `app.m9_customer_preview_runs` (dos comprobaciones privadas). La
ventana temporal se cerró al terminar, cambiando además únicamente su tabla de
control. Permanecen intactos clientes nativos, libro de crédito vacío, caja,
ventas, inventario, auditoría operativa, 61 cuentas reales y sus documentos.
La fuente QA está marcada y excluida de los totales de SICAR. Sin consentimientos
o socios nuevos. La consulta del lote sigue disponible con la ventana cerrada.

Teléfono a 390 px: sin desbordamiento horizontal; viewport normal restaurado.
933 unitarias / 110 archivos, ESLint y TypeScript PASS. El build local quedó
limitado por DNS de Google Fonts; Vercel compiló y publicó el commit de código
`1265c09756700884451181ccbedf1e807a041d87` en Preview READY. Los resultados de
browser corresponden a ese despliegue, más el ajuste visual posterior documentado
en la misma rama. Advisors sin WARN nuevos: tres INFO esperados por las nuevas
tablas privadas con RLS sin políticas, sin grants de datos para la aplicación.

Evidencia privada fuera de Git:
`outputs/m9-revision-clientes-preview-2026-10-20/`: pruebas de navegador,
capturas, ensayos SQL, auditorías, permisos y manifiesto. Tablas originales
fuente no se conceden directamente; el RPC público es SECURITY INVOKER y el
dispatcher privado SECURITY DEFINER valida auth.uid/ADMIN/permisos/staging en
cada acción. No se publicó el importador de mantenimiento ni una activación
masiva de deuda real.

Sigue ampliar el padrón y verificar identidades/contacto/consentimiento antes
de activar un vínculo real; renovar el corte antes de operar. Esta pantalla
guarda revisión, no constituye aprobación de identidad ni de entrega. Quedan
pendientes la aceptación con un vínculo SICAR real acreditado y los cobros
operativos del arranque; el ensayo no sustituye esa aprobación.
