# M9 · Padrón completo observado y centro de migración · 22 octubre

Plan previo: conservar en staging el padrón visible de171 cuentas y83 documentos
ya capturados, y consultar su cola desde el programa con identidad ADMIN real.
Se trata de un archivo histórico explícito; el corte del21 no se vuelve a fechar.
No ampliar el importador operativo de61 ni abrir los$238,218 adicionales como
deuda. No crear clientes nativos, Auth, consentimiento, abonos, reservas o entregas.

Archivo privado inmutable, RLS sin acceso de datos directo, importador sólo de
mantenimiento con actor válido y staging. Un hash de fuente identifica el corte;
repetirlo conserva el archivo, modificarlo se rechaza. Claves por UUID real SICAR
y por cuenta/folio literal; nombres iguales no fusionan identidades. El detalle
documental no observado permanece pendiente y sin ID de origen inventado.

El centro de migración reunirá catálogo cargado, registro de cuentas y saldos
operativos anteriores, nuevo padrón observado y hoja del inventario piloto.
Las cantidades físicas/despachos/separados NULL siguen pendientes, nunca cero.
Cada sección enlaza su herramienta existente. No es un botón de importar todo.

Antes de conservar el archivo: preparador reproducible por SHA, dos corridas,
ensayo y replay con ROLLBACK, rechazos de identidad/campos/totales/fecha/grants,
auditoría de tablas previas. Sólo después COMMIT del archivo privado y aceptación
de búsqueda, filtros, paginación y detalle desde Preview. Reversión por rollback
del ensayo o retiro del código de consulta; conservar archivo e historia.


## Cierre del bloque integral SICAR · Preview0.85.2 · 22 octubre2026

Publicación sólo codex/m9-staging-review:5fab93067921a11dc7d960d9c20aa4438213fefc,
árbol0b4b43f7c3739b4570fa7abcaa2c9b62181da84e. La primera0.85.0 publicó
el archivo/centro;0.85.1 corrigió el nombre de cabecera;0.85.2 añade botones
visibles, foco y objetivos táctiles44px, limitados al ancho de las tarjetas.
No se reutilizaron versiones ya publicadas. El estado de despliegue se consulta
por el statusVercel del commit GitHub: la sesión CLI anterior devuelve403, sin
necesidad de recuperar, crear o ampliar credenciales para este bloque.

Archivo privado histórico persistente:1 fila,171 cuentas/83 documentos,61 claves
previas y110 adicionales. Reintento idéntico conservahash/fecha y devuelve replay.
Saldo observado$250,128 no es apertura operativa. El libro heredado conserva
$11,910/PAYMENT0 y61 registros; cliente nativo1, sin nuevos consentimientos/Auth.
No se consultó ni escribió SICAR/Woo en este bloque; se conservan las capturas
del21 con su fecha y alcance original. No se extiende su vigencia para operar.

Pruebas:1,154 unitarias/124 archivos, tipos/lint/buildPASS; SQL22 negativos,
replay e inmutabilidad conROLLBACK, consulta real SET ROLE authenticated y
denegaciones de alta/anon. Se conservaron el intento con alias ambiguo y sus
correcciones hacia delante. Migraciones local→remota:
20261022145259→20261022145752,
20261022150118→20261022150135,
20261022150339→20261022150352. Ningún SQL aplicado se reescribió.

Paginación completa de la consulta en base:171 filas/171 claves/171 UUIDsfuente
únicos,9 páginas; filtro110 adicionales,60 con deuda y2 nombres repetidos. UI
con sesión ADMIN real: búsqueda por folio→1 cuenta, filtro110, página2de6,
nombres iguales abiertos→dosUUIDsdistintos. Catálogo completo15877variantes
(15876SICAR+fixtureprevio); búsqueda exacta2396→sombreroTombstone/talla59,
una variante. Hoja piloto12códigos y36 camposUIvacíos; no se guardaron cantidades.

Teléfono390×844 y tableta1024×768 sin desborde. Al final del teléfono,
contenido termina722.20 y menú empieza760; no tapa el último bloque. Tamaño de
navegador restaurado. No certificaSafari,hardware o impresión física. Entrada
al centro desde /clientes/heredados-sicar; revisión de versión final y botones
se añade a la evidencia de aceptación. La interfaz no habilita una etapa o cobro.

157 tablas anteriores (todas lasBASE TABLEapp/public previas) idénticas tras
ROLLBACK, archivo y recorridoUI; sólo cambia la nueva tabla de archivo. Captura
stockfalse, workerfalse,cron0, 36cantidadesNULL,12códigospiloto. No nuevo pedido,
venta, pago, caja, folio, entrega o stock. INFO RLSprivado esperado, sin nuevas
categoríasWARN; advertencias previas no declaradas resueltas.

Evidencia privada outputs/m9-integral-padron-catalogo-2026-10-22/: dos corridas,
payload/SQLprivados, resultados, auditorías157, capturas, reporte.html,
verificar.mjs y manifiesto. Código y pruebas no contienen identidades de clientes.
Sigue revisar76 detalles adicionales/abonos, conteo y compromisos físicos del
piloto, compensación de abonos heredados y corte actualizado antes de abrir
saldos. La unión financiera Woo sigue pendiente como otro frente del conjunto.
Catálogo96.92% sin cambio, no porcentajeglobal. Main/producción intactos.


Aceptación final0.85.2: statusVercel del SHA publicado success/Deployment has
completed, dashboard https://vercel.com/procesa-lab/vaquero-hub/DR92MiZQyzfvZFPDXcgBjipXUkeW.
Avatar muestra0.85.2; cabeceraMigraciónSICAR; botones visibles con mínimo44px.
Teléfono final390×844: ancho390=scrollWidth390, último bloque722.09<menú760;
tableta final1024×768: ancho1024=scrollWidth1024. Viewport restaurado y centro
abierto como entrega. Capturas y medidas finales conservadas en el expediente.
No se añadieron preguntas a los dueños. Próxima consulta de fuentes puede avanzar
sobre la cola documental; las cantidades físicas requieren captura acreditada,
no deducción a partir de saldo financiero. Esta entrega no cambia96.92%catálogo.
