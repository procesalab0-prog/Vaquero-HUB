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
