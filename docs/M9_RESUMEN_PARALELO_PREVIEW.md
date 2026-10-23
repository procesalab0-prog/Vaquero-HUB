# M9 · Integración del avance paralelo · plan previo

Usuario autorizó tres agentes paralelos. Cada uno trabaja en worktree/rama propia:
clientes/saldos, catálogo/fotos y contrato de pagos Woo. Sólo lectura remota y
pruebas locales; el coordinador concentra cualquier DDL/DML de staging y Preview.
No main, producción, nuevas órdenes Woo ni cambio del límite de cinco ensayos.

Añadir al centro /migracion un resumen de tres frentes con cifras leídas de staging,
fechas originales de los archivos, conteos piloto pendientes y controles de ensayo.
RPC sólo lectura, ADMIN activo/customers.manage, privada SECURITY DEFINER con
search_path vacío y envoltura pública SECURITY INVOKER. Sin permisos de tabla ni
nombres/contactos/folios/saldos individuales en ese resumen. Sin servicio de
aprobación, importación, apertura, pagos, actualización de foto o inventario.

Diferenciar revisiones/fotos guardadas de aptitud para vender, archivo histórico
de saldo operativo, ensayo sintético de pago verificado por proveedor. No tratar
NULL como cero ni contar lecturas como importaciones. Entregas UNKNOWN y cortes
viejos permanecen bloqueados. No dar un porcentaje global automático.

Integrar módulos puros de agentes tras revisar diferencias/pruebas, sin duplicar
importadores existentes. Los planes son inertes: nunca ejecutar un lote sólo por
ser técnicamente elegible. Auditar las165tablas antes/después, probar permisos y
lectura desde Preview con sesión real, móvil, tipos/lint/unitarias/build. Conservar
expediente privado reproducible. Reversión: retirar interfaz/RPC de consulta si
falla; ningún dato de migración previo debe cambiar ni borrarse.

## Validación integrada

Tres agentes integrados;232pruebas nuevas,1,423/132PASS,lint/tipos/buildPASS.
165tablas idénticas;ACL comprobada;sin nuevos avisos de seguridad.
Ver cierres del handoff y plan maestro para alcance,límites y próximos adaptadores.


### Cierre aceptado · Preview0.88.0 · Tres frentes paralelos

DespliegueSUCCESS `fccde53bd5815beb8db095ecb80bada99f804162`, árbol idéntico
local/remoto `09e81637b071b0dae78afede5ba26df1148ba30a`, rama codex/m9-staging-review.
Vercel: https://vercel.com/procesa-lab/vaquero-hub/Cp4AYwmEHXawFMxWMf1fChhkB3US .
SesiónADMIN real: /migracion→botón «Ver avance, bloqueos y siguientes lotes»→
/migracion/avance; versión0.88.0 visible en avatar. Cifras agregadas coinciden.
Escritorio1440x1000 y teléfono390x844 aceptados. ScrollWidth390=viewport390;
botón final termina704.83px, por encima de navegación inferior752px. Restituido
viewport original y dejado resumen abierto. No se ejecutan botones de ensayo.

Auditoría165tablas repetida después de la navegación: hashes/conteos idénticos
al inicio. Evidencia privada y reporte conjunto con manifiesto/verificador en
outputs/m9-avance-paralelo-2026-10-22/. Verificadores de clientes55archivos,
Woo y fotos3/4 idénticos PASS. Las variantes/copias comprobadas son metadatos,
no nuevos bytes; el contrato financiero documental nunca autoriza una venta.
No se importó saldo, existencia o costo ni se crearon pedidos. No main/producción.


### Preview 0.89.0 aceptado · 22 de octubre de 2026

Tres agentes terminaron clientes/saldos, fotos y libro web; el coordinador revisó,
aplicó y auditó los cambios de staging. Despliegue SUCCESS
`301773a37680d43db6c418cc3f5d381e87e80360`, árbol local/remoto idéntico
`45744cebd4a52671bb74dea40d22fb4386e4e380`, sólo codex/m9-staging-review.
Vercel: https://vercel.com/procesa-lab/vaquero-hub/HpEc4WSojPM8YX5MqYWZr6ZS4M66 .

Aceptación con ADMIN real: versión 0.89.0, 114 cuentas/53 generales, seis páginas,
dos páginas de veinte sin solapamiento, referencia exacta con un resultado y
enlace al archivo de esa cuenta. Resumen actualizado con 15,876 códigos, 5,984
evidencias y 5,871 copias. Foto nueva de variante cargada desde Storage de staging
(naturalWidth256). Teléfono390x844 sin desborde horizontal; paginación funcional.
Viewport restituido y resumen abierto. No se pulsaron controles financieros.

Auditoría final: 172 tablas; navegación posterior sin cambios. De las 165 tablas
previas, 154 permanecen idénticas; los once cambios corresponden exactamente a
seis tablas de origen/registro, cuatro de fuentes/fotos/categorías y audit_log.
Catálogo, UUIDs, códigos, precios, costos, stock, caja y finanzas nativas iguales.
Siete documentos/$11,910 previos intactos, ledger nativo0. Libro web vacío/control
false; worker/captura/stock/finanzas false, ensayos conectados5, sin sexto ensayo.
Siete categorías SOURCE_CHANGED retenidas; revisión vigente pendiente.

Seguridad: WARN anteriores134+1 sin hallazgos nuevos. INFO109→116: las siete tablas
privadas nuevas tienen RLS y no permiten acceso directo de clientes; se mantienen
protegidas. No se modificaron avisos anteriores ni se debilitaron permisos.

Expediente privado: outputs/m9-adaptadores-aplicados-2026-10-22/reporte.html,
manifest.json y verificar.mjs. Verificación offline PASS54archivos: hashes, rollback,
cuentas, fotos, auditoría, controles y seguridad. No usa red ni ejecuta SQL. Se
detuvo sólo m9-woo-qa-20261022, conservando sus bases. No main ni producción.

Historial de DDL aplicado por MCP (versiones remotas reales):
- 20261022225100 m9_legacy_registry_paged_readonly
- 20261022225631 m9_general_customer_archive_registration
- 20261022225915 m9_web_settlement_synthetic_ledger
- 20261022225921 m9_variant_photo_protected_refresh
- 20261022231645 m9_photo_refresh_catalog_and_lock_guards
Los archivos locales conservan las marcas CLI de creación; no repetir db push
sin conciliar primero este historial. No editar los cuerpos ya aplicados.

Siguiente bloque: corte actualizado acreditado, 36 campos físicos de los doce
códigos, 17 líneas sin variante, entregas aún UNKNOWN, revisión vigente de siete
categorías y proveedor autenticado en sandbox para el ciclo completo Woo.
El archivo general no abre cobros y las fotos no autorizan una venta.


### Corte SICAR, categorías y vínculo documental · Preview 0.90 · 22 octubre 2026

Nuevo SICAR: 16,396 códigos únicos; SHA b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93.
Dos conciliaciones produjeron diez archivos idénticos. Frente a SICAR19:15 nuevos,
0 ausentes,21 cambios de catálogo y74 de existencia (uno también de catálogo).
Woo autenticado sigue siendo Oct19; siete consultas públicas de categorías del22
son evidencia independiente. No se re-fechó la fuente ni se importaron existencias.

Quince altas provisionales conservadas: un código histórico exacto y14 nuevos,
15,876→15,891 administrados. Clave1 literal, costoNULL, un padre/variante, sin
atributos inferidos, WooID ni inventario, web_release=false. Dos clasificaciones
conflictivas siguen retenidas. Adaptador incremental con conjunto completo de
tablas y verificación de cada fila previa; no exige vaciar libros con historia.
Alta/replay con ROLLBACK172 y174 idénticas; COMMIT suma ocho tablas de registro y
seis eventos audit por código. Secuencias no se rebobinan ni se promete borrar
altas con historia.21 cambios existentes tienen plan separado sin aplicación.

Siete categorías recuperadas con evidencia pública nueva y revisión de49fotos/
copias exactas. Aplicar/replay/compensar con ROLLBACK174 idénticas; COMMIT7/replay.
5,984 evidencias y5,871 copias permanecen iguales. Esto no habilita publicación.
Diario privado de entregas instalado/ensayado con ROLLBACK y quedó vacío;84
expedientes por documento,183 entregas UNKNOWN. No nueva pantalla de respuestas.

Vínculo literal de una línea histórica conservado en diario aditivo: BIND/replay,
REVOKE/replay y ROLLBACK175 tablas idénticas, luego COMMIT sólo1fila del sidecar.
Archivo/fuente retienen166mapeadas/17sin variante y variant_idNULL original;
167identidades documentales efectivas sólo al sumar el sidecar. Los lectores
operativos no lo consumen. UNKNOWN, cero permiso de entrega o apertura financiera.
Revisión cruzada corrigió carrera FK/FORUPDATE: ProductsEXCLUSIVE→VariantsEXCLUSIVE
antesSHARE; pruebas reales de dos conexiones en ambos órdenes, sin deadlocks.

Validación integrada:1,675 pruebas/141 archivos, lint/tipos/build PASS. Stage175,
ningún nuevoWARN (134+1 anteriores), tres INFO RLSsinpolicy esperados por tablas
privadas con acceso directo denegado. Ensayos conectados5, worker/captura/stock/
finanzas false, libro web vacío; siete saldos/$11,910 anteriores intactos.
Cuarentena sandbox sólo autentica firmasQA: ningún proveedor de pagos acreditado.

DDL remoto real:20261022234933 categorías,20261022234934 observaciones de entrega,
20261023000659 vínculo literal. Los archivos CLI locales tienen sus propias marcas;
no repetir db push sin conciliar historial ni editar cuerpos aplicados.
Expediente privado outputs/m9-renovacion-integrada-2026-10-22; fuente/PII/SQLreal
fueraGit. Publicar sólo Preview; aceptación/despliegue se documentan al concluir.
Siguiente: corteWoo autenticado, actualizar21cambios mediante planes independientes,
36campos físicos del piloto y entregas aún UNKNOWN, proveedor sandbox auténtico.
No main, producción ni Woo real modificados.


### Aceptación Preview 0.90 y cierre del bloque

Despliegue SUCCESS fe8ac8845e2e6db795dc24945ceeb8c22f2b7efe; árbol idéntico
c1dd24d561cf33b3b9ac48dc90f3e7d07493678b, sólo codex/m9-staging-review.
Vercel: https://vercel.com/procesa-lab/vaquero-hub/3f6ms2ges7HzXPUFRpQ1GwL5jkkr .
ADMIN real verificó versión0.90.0, aviso del corte16,396/15altas, resumen15,891,
Woo19 claramente distinguido y búsqueda del código nuevo con precio público exacto.
Escritorio1440 y teléfono390 sin desborde horizontal; viewport restituido. No se
pulsaron controles financieros. Navegación conserva las175tablas completas.

Expediente privado: outputs/m9-renovacion-integrada-2026-10-22/reporte.html,
manifest.json y verificar-bloque.mjs. Verificador offline PASS19comprobaciones,
103archivos fijados; sin red, SQL ni escrituras. Cubre fuentes, dos corridas,
rollback172/174/175, deltas de COMMIT, controles apagados, seguridad y aceptación
Preview ligada al mismo commit/árbol. Recibos de agentes re-verificados:12,23,17
archivos. Se detuvo únicamente el contenedor localm9-woo-qa-20261022, conservando
sus bases. No main ni producción. Bloque cerrado; no declara terminada la
migración total ni autoriza arranque operativo.


### Bloque de ampliación y preparación operativa · Preview 0.91 · 22 octubre2026

Tres agentes y coordinador:70altas provisionales adicionales,10precios públicos
y lector de entregas por documento. Sigue exclusivamente staging; no main,
Woo real, existencias, costos ni saldos operativos.

Cobertura por intersección literal con SICAR22:15,891→15,961 de16,396,0códigos
administrados ajenos al origen.97.35% de presencia de catálogo;435 pendientes.
No representa un porcentaje global. Cuatro lotes20/20/20/10 ensayados con
alta/replay/ROLLBACK,175tablas idénticas cada vez. LuegoCOMMIT y comprobación
de toda fila previa bajo barrera; ocho tablas+70 y audit+420, sin cambios ajenos.
85altas en los últimos dos bloques, cada una con código literal,costoNULL,
atributos{},sin WooID ni inventario,web_release=false. Los motivos de435held
se superponen:316exhibición,86taxonomía,40precioinválido,3conflictocategoría.
Se corrigió pending para no descontar códigos de destino ajenos a SICAR.

Diez precios980→1150 conservados exclusivamente enMiTienda, con m9_rows como
proyección vigente. Corteoriginal/source_sha/raw/source_evidence inmutables;
la procedencia nueva queda en eventoAPPLY. Provisional/UUID/Clave1/costoNULL/
webfalse conservados, sin contexto Woo. Los otros11cambios siguen held.
APPLY/replay/REVERSE/replay conROLLBACK176idénticas;COMMIT10/replay sólo cambia
variants,m9_rows,diario+1 y audit+11, otras172tablas idénticas. Compensación
condicionada rechaza una edición posterior.24SQL+24unitarias y2carreras reales
locales, sin interbloqueos; revisión independiente sinP1.

Nuevo /migracion/entregas:8documentos por página, opciones informativas juntas,
enlace por documento exacto y deudaSX00000 sin convertir cantidad en piezas.
SóloGET/lectura, todavía sin captura de respuestas ni cambios de deuda/stock.
ADMIN activo+customers.manage+guardia de staging antes de cada ruta del lector;
wrapperpublicinvoker/helperappdefiner consearch_pathvacío y actoreslimitados.
Escritores siguenprivados. QA22negativos/6ACL/25unitarias,168tablas idénticas.
Lectura real previa aldeploy:11páginas,84documentos únicos,166/17archivo más1
sidecar=167identidades;183UNKNOWN y0observaciones;176tablas idénticas. Anon y
service_role sin acceso;0grants nuevos sobre escritores o helpers de precios.

Evaluador reproducible por hitos con36unitarias: conserva medición anterior y
posterior70 por separado.5,871/5,871copias de variantes confoto documentada es
un subconjunto, no cobertura de fotos de todo catálogo.113ausencias explícitas
preservadas. Piloto0/36campos,0/12códigos completos. Entregas0/183confirmadas,
primer ciclo externo auténtico0/1. GlobalyETAsinmedir; no sumar unidades.
Falta proveedor sandbox acreditado y perfil de aislamiento: guard1.6 impide
checkout/egress/gateways y el GET financiero sólo admite pedidos sintéticos
cancelados. No habilitar esto ni un sexto ensayo bajo autorizaciones anteriores.

Validación integrada:1761pruebas/144archivos,lint/tipos/buildPASS. Seguridad119→120
INFO por nuevo diario privado conRLS;WARN134+1 anteriores idénticos. Worker,
captura,stockyfinanzas false,ensayos5,libroweb0; libro nativo de crédito0.
7saldos/$11,910 en libro separado de ensayo intactos; no son apertura nativa.

DDL remoto real:20261023012737 m9_sicar_public_price_refresh,
20261023013222 m9_delivery_document_review_read. Archivos locales conservan sus
marcasCLI; no repetir dbpush ni editarSQLaplicado. Expediente privado
outputs/m9-avance-operativo-2026-10-22 y m9-hitos-preparacion-2026-10-22.
SICAR22 intacto;Woo completo sigue19octubre. Usuario aplazó Chrome; se continúa
staging sin exigir acceso. Deploy/aceptaciónPreview0.91 se documentan al terminar.
