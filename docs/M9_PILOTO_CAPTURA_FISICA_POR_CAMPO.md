# M9 · Captura física del piloto existente

Plan previo del 22 de octubre de 2026, desde `764f742`. Root es el único
escritor/deployer de staging. Este agente sólo consulta staging y ensaya en el
clon QA asignado `qa_m9_piloto_block5_20261022`, PostgreSQL 127.0.0.1:59432.
No se inventan datos del inventario real ni se escriben saldos, reservas, caja,
finanzas o pedidos. No se cambia ninguna compuerta Woo ni el límite de ensayos.

## Inspección del flujo que ya existe

`/clientes/heredados-sicar#piloto` presenta los doce códigos y sus tres campos:
total físico, vendido pero guardado para entregar, separado sin venta. Cada
formulario usa `inventory.count`, luego `m9_legacy_pilot/SAVE_STOCK_DRAFT` con
ADMIN activo, customers.manage, permiso de conteo y acceso a sucursal. Guarda
NULL explícito, rango entero, revisión optimista y huellas de catálogo/saldo;
no toca inventario. El evento inmutable existente conserva antes/después,
actor y fecha del guardado. No se necesita otra pantalla ni libreta.

Consulta de staging: doce códigos, 36 cantidades NULL, once filas revisión 1 y
una revisión 2 que sólo registró una nota; catálogo/saldo de las doce vigentes.
Referencia SICAR observada el 20 de octubre: no se considera renovada al 22 y
no es conteo físico. Ningún guardado con NULL se convierte en cero.

Brecha: la nota es común. No existe responsable/fecha/fuente explícita por cada
cantidad. Una corrección posterior no permite distinguir la declaración vigente
de cada campo únicamente leyendo la proyección. La API acepta el guardado sin
declaración por campo, por lo que no se presentará como conteo certificado.

## Forward estrecho propuesto

Reutilizar el registro y eventos existentes. Añadir una columna JSON de evidencia
por campo a `app.m9_pilot_stock_drafts`; no crear otra tabla de conteos. Para
cada cantidad nueva/cambiada distinta de NULL exigir declaración humana expresa
y fuente textual de ese campo. Actor y fecha de declaración los fija el servidor;
la interfaz dice que es declaración actual, nunca fecha histórica comprobada.
Sin respuesta permanece UNKNOWN. Limpiar a NULL retira la evidencia vigente y
conserva antes/después/razón en el diario existente. Lo no cambiado preserva
su responsable y fecha, sin recertificar por guardar una nota.

Ligar la declaración a código/UUID/sucursal/revisión y huella de fuente actual
(referencia SICAR, su evidencia/fecha, catálogo y saldo). Un cambio de fuente,
catálogo o saldo vuelve la evidencia retenida, no la renueva. Una captura no
acredita el corte operativo final ni habilita aperturas. El guardado histórico
sin metadata sigue disponible para notas/NULL; no puede introducir cantidades
noNULL sin declaración. Respuestas previas sin evidencia no se convierten en
declaraciones nuevas por un DEFAULT de migración.

Mantener API privada, guardas antes de cualquier rama, wrapper público invoker,
RLS y denegación de acceso directo. No ampliar a inventory.adjust: se conserva
el permiso de conteo `inventory.count` y acceso de sucursal existentes.

Ensayar localmente con fixtures claramente sintéticas: NULL/cero, campo aislado,
evidencia obligatoria, nota sin recertificar, corrección/limpieza/repetición,
revisión obsoleta y cambio de fuente/catálogo/saldo; ACL y actor inválido antes
de toda ruta; fallo atómico y conservación de todos los libros operativos.
Revertir pruebas con ROLLBACK, sin borrar historia ni inventar saldos reales.
Root generará/aplicará cualquier migración forward después de revisar.

## Implementación y comprobaciones locales

Entrega aditiva en `scripts/m9/pilot-field-declarations.sql`, sin archivo de
migración ni ejecución remota por este agente. La misma hoja incorpora
`field_evidence`; el diario sigue siendo `app.m9_legacy_pilot_events/STOCK_DRAFT`.
La interfaz existente incluye tres confirmaciones y fuentes independientes,
responsable/fecha del servidor y estado vigente/retenido. Las casillas siempre
aparecen desmarcadas. Una nota no refresca fecha, autor o fuente de una cantidad.
No se muestra la comparación completa mientras falte una declaración vigente.

La huella de fuente incluye Clave 1, UUID, sucursal, referencia SICAR y sus
fecha/hash, catálogo y saldo esperado/actual. La revisión del borrador se
comprueba aparte: se conserva en cada declaración como `captured_revision`,
pero no invalida los demás campos sólo por guardar una nota. Cantidades
anteriores sin metadata no obtienen responsable por defecto y no se pueden
preservar como verificadas sin una declaración explícita.

Se cerró una inversión de locks detectada por la revisión independiente de
clientes: el escritor operativo toma inventario y después el trigger bloquea
la variante, mientras que el borrador protege primero el catálogo. Todas las
barreras y el `FOR UPDATE` del borrador usan NOWAIT; el nonce usa try-lock.
Una excepción transaccional 55P03 `M9_PILOT_BUSY_RETRY` revierte las barreras
adquiridas y permite recargar/reintentar, sin esperar manteniendo el catálogo.
La interfaz muestra ese resultado como intento no guardado. Un replay devuelve
su recibo histórico original; la interfaz lo distingue de un guardado vigente.

Validación del 22 de octubre en el clon asignado:

- 20 pruebas unitarias, ESLint y TypeScript correctos.
- 17 invariantes y 21 rechazos adversariales: NULL/0, actor/permisos, fuente,
  revisión, catálogo/saldo, retiro, replay y atomicidad. ROLLBACK exacto de las
  168 tablas app/public del clon. Los libros operativos no cambiaron.
- Cinco escenarios concurrentes con conexiones independientes: escritor nativo
  primero, borrador primero, deriva de catálogo, deriva de fuente y nonce en
  vuelo. Dos llamadas reales a `public.apply_inventory_adjustment` sobre
  fixtures sintéticas propias completaron su trigger y terminaron en ROLLBACK.
  No hubo deadlocks. Al fallar NOWAIT no quedó ningún bloqueo parcial del
  borrador, incluso antes de cerrar la transacción del llamador recuperado.
- El ensayo de carreras conserva doce fixtures locales sintéticas inactivas y
  la historia local de catálogo/fuente; seis libros operativos quedan idénticos
  antes/después. Las 36 cantidades del piloto permanecen NULL y no se retiene
  ningún evento de captura de prueba. No equivale a rollback de todo el esquema
  de ese segundo ensayo. Secuencias PostgreSQL pueden avanzar con rollbacks.

Reproducción: usar exclusivamente `QA_DATABASE_URL` con
`postgresql://...@127.0.0.1:59432/qa_m9_piloto_block5_20261022`. Ambos runners
rechazan otro host/puerto/base. `pilot-field-declarations-qa.mjs RESULTADO.json`
requiere una hoja vacía y revierte todo; ejecutar primero.
`pilot-field-declarations-race-qa.mjs RESULTADO.json` requiere hoja y códigos
sintéticos ausentes, conserva sus fixtures inactivas al terminar y por eso no
se repite sobre el clon ya usado. No retocar guardas para repetirlo: root puede
preparar otro clon limpio bajo una autorización nueva y adaptar la lista de
bases expresamente. No requiere credenciales reales ni nuevas órdenes Woo.

## Revisión y ensayo de staging pendientes de root

1. Revisar el forward y generar su migración. Aplicarla sólo en staging; no
   cambiar permisos, compuertas ni apertura del inventario.
2. Antes/después: verificar las doce filas y las 36 cantidades desconocidas,
   catálogo/saldo, huellas de fuente y libros de inventario/caja/deuda.
3. Desde Preview con sesión real ADMIN + customers.manage + inventory.count,
   guardar sólo una nota técnica explícita con las tres cantidades NULL.
   Ensayar también por SQL transaccional con ROLLBACK y auditar igualdad.
4. Confirmar actor/fecha/evento, replay histórico y rechazo de actor sin
   permisos. No usar valores sintéticos en la interfaz de staging. Auth y
   PostgREST reales todavía no están certificados por estas pruebas locales.
5. Hacer que personal de tienda declare los tres datos reales por código con
   su fuente actual. Son **0 de 36 campos físicos confirmados**, no doce
   inventarios listos. Renovar/conciliar la referencia SICAR y las entregas
   pendientes antes de cualquier apertura operativa separada.

Compensación lógica: limpiar el campo a NULL con una nota explícita añade otro
evento y retira sólo la evidencia vigente. El before/after previo permanece
inalterado. No se elimina historia, no se resta stock, no se abre un saldo y
ninguna evidencia externa se convierte en dinero/inventario automáticamente.
Los controles Woo, proveedor autenticado, pagos y límite de cinco ensayos
permanecen fuera de este forward.

Evidencia privada (fuera de Git):
`outputs/m9-piloto-captura-campos-2026-10-22/qa-local-nowait.json`,
`qa-local-races.json` y `staging-pilot-before-read.json`. El último es la
consulta previa de sólo lectura, no una aceptación del forward en staging.
