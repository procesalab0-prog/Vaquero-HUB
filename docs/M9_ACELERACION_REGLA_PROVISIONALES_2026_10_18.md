# M9 · Regla de tallas y catálogo provisional · 18 de octubre de 2026

## Autorización y alcance

Emmanuel autorizó: «autorizo la mejor vía para avanzar más rapido pero seguro»,
y añadió «pero si hay que implementra las que siguen despues». Se implementaron
la regla T., la carga provisional y el preparador de actividad exclusivamente
para staging. No se autoriza un corte productivo, importar existencias ni
escribir en Woo real.

Esta es una excepción explícita a la política anterior de preguntar cada familia:
una decisión por regla puede habilitar carga de catálogo en staging. No crea
respuestas SAME_MODEL ni atribuye confirmaciones a los dueños. La muestra de 20
familias tuvo revisión técnica de sus datos SICAR por Codex; no confirmación
comercial de los dueños. La evidencia conserva owners_confirmed_sample=false.

## Resultado verificado

| Concepto | Códigos |
| --- | ---: |
| Corte SICAR del 12 de octubre | 16,310 |
| Cargados antes del bloque | 7,810 |
| Nuevos por regla T., 209 familias | 823 |
| Nuevos provisionales independientes | 7,243 |
| Total cargado en staging | 15,876 |
| Sin cargar, retenidos | 434 |

Cobertura de carga: **97.3391 %**, antes 47.8847 %. No es el porcentaje de
terminación operativa de toda la migración. Hay 8,989 productos padre:
1,746 agrupados y 7,243 provisionales de una variante. Los agrupados incluyen
las retenciones históricas existentes; cargado no significa autorizado a cobrar.

Auditoría final: 15,876 códigos únicos, cero diferencias entre proyección viva
y fila registrada, cero errores de provisionales. Los 7,810 IDs y padres
originales se conservaron. Huella del conjunto de 8,633 anterior a provisionales:
7902c91cb956a70701defe4d67d38fe3, idéntica al cierre. Se conservó el código literal
000007779. Saldos, movimientos, ventas y apartados: cero.

## Vía 2: regla explícita T.

Se recalculó todo el corte; no se trasladó la cifra antigua de 302 familias.
Requisitos conjuntos: base literal idéntica, delimitador T., talla simple
distinta, mismo precio1 literal, departamento y sección, familia completa en
todo SICAR, sin colisiones de destino ni excepciones. No se cortan finales
numéricos ni se incorporan dimensiones talla por largo con esta regla.

209 familias / 823 códigos pasaron. Se conservaron exclusiones por registros
únicos, precio distinto, familia incompleta, otras clasificaciones, dimensiones
y excepciones anteriores. Los motivos se superponen. No se retiró la reserva
de CAWRNIÑO3587 por una regla general ni se modificaron preguntas principales.

Semilla M9-2026-10-18-T-literal-1. Conjunto:
f69d44840946e9a062c4034c94488c86c41bfbc27ebf0abf81fd45431a3bfab6.
Muestra:
4b3fc99460b19b6690af56fd8728c07591a2b1450a30cc45e50e3d0e7dba10de.

Nueve lotes tuvieron plan, carga transaccional, repetición sin nuevas altas,
comparación exacta y ROLLBACK. Después se conservaron los nueve lotes sólo en
staging, con las mismas comprobaciones y auditoría por regla. Los costos
desconocidos quedaron NULL, no cero.

## Vía 1: provisionales y agrupación posterior

Cada código elegible pendiente entró como un producto de una variante, con
descripción SICAR completa y Clave 1 intactas. El nombre de presentación añade
[SICAR código] para evitar colisiones de nombres; no cambia la descripción
original ni el código. No se infiere talla de sufijos. Precio1 es el precio
público, sin costos ni mayoreos supuestos.

La nueva tabla privada app.m9_provisional_variants conserva evidencia original,
estado PROVISIONAL, padre original y web_release=false. Las ambigüedades de
coincidencia Woo se conservan en evidencia, sin asignar IDs Woo ni fotos dudosas.
El departamento también queda en el padre para las consultas generales, a
partir del dato literal por variante; no se modificaron departamentos anteriores.

Bloqueos en servidor impiden crear vínculos Woo y trabajos de publicación
local/remota para provisionales, incluso después de agrupar hasta otra revisión
web explícita. No se concede acceso directo a tablas o funciones privadas a
anon, authenticated ni service_role.

app.m9_provisional_group_plan, app.m9_group_provisionals y
app.m9_undo_provisional_group implementan mantenimiento de agrupación sólo
para el operador postgres y staging. No hay todavía un botón ni RPC de gerencia.
La primera versión exige misma sección, departamento y unidad, atributos
distintos, revisión con motivo/evidencia, token vigente e idempotencia.
Conserva variant_id, SKU, códigos, precio y datos de inventario. Padres e
historiales se conservan. La reversión exige que el estado del catálogo no haya
cambiado; no restaura una base vieja ni borra operaciones posteriores.
No equivale a una herramienta universal para todas las agrupaciones comerciales.

Quince controles SQL con ROLLBACK verificaron agrupación, desagrupación,
idempotencia, rechazo de atributos repetidos, token incorrecto, permisos,
vínculos y colas Woo. Inventario sintético de dos piezas y un movimiento a tres
piezas posterior a agrupar sobrevivieron a desagrupar; todo el ensayo se revirtió.
No hubo una venta positiva probada. El primer comparador falló por updated_at:
se corrigió el ensayo para comparar todos los campos comerciales, conservando
el timestamp legítimo de mantenimiento.

Se ensayaron 100 provisionales con rollback antes del piloto y otros 100
después del ajuste de clasificación. Cada lote conservado tuvo plan actual,
comprobación exacta de filas/registro privado, huella del catálogo anterior y
libros operativos vacíos. No se declara un rollback individual de los 7,243.

## Retenciones y recuperación

434 códigos siguen sin cargar. Motivos, con superposición:

- Clasificación: 86.
- Exhibición o restricción de venta: 316.
- Precio público inválido: 40.
- Conflicto de categoría del destino: 2.

El lote inicial 8 se rechazó por CATEGORY_CONFLICT para 15550; toda esa
transacción se revirtió. Se recalculó el remanente excluyendo ambos conflictos,
sin renombrar ni reactivar categorías. Se conservaron 700 provisionales del
primer plan y 6,543 del plan reanudado.

El conector perdió el transporte después de guardar el lote reanudado 34.
Se consultó el estado real y se verificaron sus 100 filas contra el payload,
registro privado, departamento y huella anterior. No se repitió la carga.
Los intentos y sus verificaciones se conservan, incluidos errores intermedios.

## Vía 3: actividad y archivo

activityPlan está implementado como preparador de sólo lectura. Exige al menos
12 meses, manifestaciones completas del mismo corte, todas las ubicaciones y
huella del conjunto de códigos. No interpreta ausencia de filas como cero sin
declaración de alcance completo. Excluye negativos, modos no inventariables,
ventas aunque hayan sido devueltas y compromisos abiertos. Pedidos Woo con
estado desconocido impiden proponer archivo.

Faltan exportaciones de existencias por sucursal/almacén, ventas con devoluciones
y cancelaciones distinguibles y compromisos pendientes. También falta confirmar
los pedidos Woo abiertos. Por ello no se archivó ni se excluyó por inactividad
ningún código. La carga completa en staging no decide el catálogo del corte real.

## Verificación, evidencia y reproducción

717 unitarias / 99 archivos, lint y formato dirigidos correctos.
Dos ejecuciones finales de la regla conservan los nueve archivos idénticos.
Las dos migraciones nuevas se aplicaron sólo a zsezjtswqeijboezvado:

- 20261019003832_m9_provisional_grouping_staging.sql.
- 20261019004747_m9_provisional_department_metadata.sql.

Los nombres de versión se conciliaron con el historial remoto; los archivos
habían sido generados primero con la CLI y se conservaron sus bytes SQL.
Asesores revisados: INFO RLS sin políticas en tablas privadas es intencional;
siguen advertencias previas de funciones definer y protección contra contraseñas
filtradas. No se declara una revisión global de seguridad limpia.
[Referencia de asesores](https://supabase.com/docs/guides/database/database-advisors).

Evidencia en outputs/m9-reglas-provisionales-2026-10-18 del workspace de
migración: config-formato.json, autorizacion.json, corridas 3/4, SQL, recibos de
carga/ensayos, planes provisionales, auditoria-final.json,
verificacion-conjuntos.json y reporte-final.html. Los generadores y tests viven
en scripts/m9 y tests/unit. No se publican exportaciones completas en GitHub.

Reproducción de la regla, desde la copia de código de este bloque:

```sh
node scripts/m9/run-acceleration.mjs CONFIG_FIJADO NUEVA_SALIDA AUTORIZACION_FIJADA
```

Los planes de carga son específicos de una captura. No volver a ejecutar SQL
conservado sobre un destino que ya cambió: preparar una captura y plan nuevos.
La evidencia histórica aplicada no se rebasea a una fuente distinta.

## Compuerta operativa pendiente

El ensayo anterior de cobro detectó que sale_items.unit_cost_cents no admite
NULL aunque las variantes migradas tienen costo desconocido. Sigue pendiente
resolverlo junto con utilidad, devoluciones y cobros positivos, sin poner costo
cero ficticio. La agrupación no prueba esos flujos monetarios.

La revisión de venta del bloque anterior se conservó intacta y está vencida
desde el 18 de octubre a las 9:33 de México: sigue rechazando operaciones.
No se renovó, desactivó ni amplió su lista con este bloque. Cero cambios en
catálogo/inventario productivo o Woo real. Antes del corte real: fuentes nuevas,
inventario autorizado, pruebas operativas y autorización productiva explícita.


### Límite de comprobación visual y publicación del código

La comprobación visual del reporte en Chromium no se completó: el proceso
requiere permisos locales fuera del sandbox. La revisión automática del comando
escalado (Chromium y git fetch de staging) falló por capacidad del modelo de
revisión, indicando expresamente que no fue una determinación de inseguridad y
que el comando no se ejecutó. No se eludió el control ni se declara QA visual.
Las 717 pruebas unitarias, SQL y auditoría alojada anteriores sí terminaron.
El código queda en la rama local codex/m9-reglas-provisionales; no se publica ni
se integra a main en este bloque.
