# M9 · Control único de preparación del piloto

Plan previo desde `f1ceb12`, sólo Preview/staging. La hoja del piloto, las
respuestas documentales y los saldos de ensayo ya existen. Falta reunir sus
alcances y procedencias sin presentar una cantidad escrita, un folio o una
apertura histórica como permiso de arranque. No se añade otro formulario,
importador, libro, permiso, RPC o SQL.

La sección optativa ` /migracion/avance?control=piloto ` reutiliza el overview
existente y, sólo tras comprobar staging, customers.manage e inventory.count,
consulta tres lectores actuales: registro heredado (stock completo de doce
códigos, aunque clientes estén paginados), captura documental (primera página
sin filtros y resumen global) y finanzas LIST (array completo, sin paginación en
su contrato). No usa TRIAL ni otro escritor. La ruta normal conserva una sola
consulta. Lecturas independientes no equivalen a una transacción simultánea.

El evaluador puro reusa el progreso/declaraciones de la hoja y valida Clave1,
ubicación, UUID, revisión, NULL/cero, límites de cantidades, páginas/totales,
consistencia con overview e intervalo de fuente. Distingue los 36 datos aún
UNKNOWN de los declarados vigentes y retenidos. Contrastar cantidades completas
no certifica conteo ni acredita el efecto anterior de inventario.

Cuatro pasos mínimos: contar las doce referencias en tienda y declarar cada
dato realmente revisado en el formulario existente; revisar mercancía
comprometida contra folio y línea (sin pedir cientos de respuestas por nombre);
renovar censo/detalle por cuenta completa antes del corte; evaluar por separado
la apertura financiera con el evaluador y autorización existentes. Las
respuestas de entrega son declaraciones documentales: incluso ALL_DELIVERED no
prueba una observación física ni habilita movimientos. SX00000 no son piezas.
Las siete aperturas de ensayo no confirman siete saldos operativos actuales.

La evaluación de apertura permanece NO_EVALUADA; no se mide desde cantidades,
respuestas de entrega o saldo archivado. UNKNOWN físico no se transforma en un
bloqueo global artificial de una apertura puramente financiera futura con su
propia evidencia completa. El control sólo informa; no autoriza inventario,
reservas, cobro o producción, ni crea un porcentaje global.

Si falla un lector, permiso o contrato, se muestra evidencia no comprobable,
no cero pendientes. Para la relectura no se copian nombres, teléfonos, importes
individuales ni respuestas a la sección. Se conservan fechas originales y la
fecha de evaluación por separado. El cierre privado del 23 octubre no cambia.
Reversión: retirar sólo helper/sección de código; no hay datos que compensar.

QA prevista: permisos antes de consultas adicionales y cero adicionales sin
opt-in; fuentes incoherentes/paginación parcial/error sin fuga PII; doce claves
literales/36NULL; cero declarado, cantidad sin evidencia o retenida;
compromisos mayores al físico; corte viejo/futuro/calendario imposible;
ALL_DELIVERED sin liberar físico/apertura, saldos completos sin inferir deuda
vigente. El agente no usa navegador, red, DB ni Docker; root integra y acepta
Preview con Auth real.

## Entrega y límites comprobados

La ruta normal conserva una consulta overview. Sólo `control=piloto` monta la
sección de servidor, con tres lecturas adicionales tras los dos permisos.
La sección no tiene formularios, opciones, nonces, claves privilegiadas ni
acciones de escritura. Las respuestas crudas permanecen en servidor y sólo
salen contadores, intervalos y avisos; cualquier error queda como no comprobable.
Los totales del registro y sus páginas de veinte, el resumen documental global
y sus páginas de ocho y el array financiero completo se comprueban según sus
contratos reales, sin inventar paginación financiera. La consulta documental
sólo necesita la primera página y su resumen global, no exporta 183 líneas.

Se reutiliza la validación de doce Claves1/UUIDs/La Piedad y el progreso existente.
La comparación temporal conserva calendarios y claves UTC de seis cifras,
incluido PG `+00`, ISO `Z` y `+00:00`; un intervalo invertido dentro del mismo
milisegundo se rechaza. La UI muestra un intervalo original compacto, con acceso
a la hoja por código. No convierte la fecha de evaluación en fecha del conteo.

Se corrigió también el texto obsoleto del avance: corte Woo autenticado del
23 octubre, 2,173 padres/12,258 variaciones, 90 resultados distintos y 19 pares
Woo por revisar. Fuente privada fijada: `woo/renovacion/resultado-integrador.json`
del cierre 23 octubre, SHA256
`97f16f68ece0316338fa1d4c399a5d63d1d7cf8fb6f220a2781d881988354302`.
Es análisis conservado, sin adopción automática de la proyección de staging.

QA: **109 pruebas en seis suites**, incluidas 44 nuevas, correctas; ESLint y
TypeScript correctos. Se cubren fronteras de permisos, opt-in, contratos/páginas,
NULL/cero con y sin evidencia, stock imposible, deriva y fechas, fuentes
inconsistentes y ocultación de datos personales/errores. No se repitió SQL ni se
aceptó Auth o vista móvil. Revisión independiente de catálogo sin bloqueantes;
aceptación real de Preview y auditoría final corresponden al coordinador.

No se añadieron preguntas a los dueños: los huecos técnicos se resuelven con
validaciones y enlaces existentes. Sigue pendiente una comprobación real de
cantidades y compromisos de los doce códigos y un corte completo de clientes
por cuenta, con su autorización separada. Evidencia privada nueva:
`outputs/m9-siguiente-bloque-2026-10-24/clientes/`; el cierre anterior sigue intacto.

Revisión de navegación: el enlace opt-in desactiva explícitamente el prefetch
de Next. Mostrarlo, enfocarlo o pasar el puntero no debe preparar por anticipado
las tres consultas adicionales. Una aserción sobre las props reales del enlace
protege ese límite; la ruta normal conserva su única lectura overview.
