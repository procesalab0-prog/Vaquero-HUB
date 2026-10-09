# Revisión protegida de productos con nombres iguales

## Resultado

Se cargaron **153 variantes / 24 productos adicionales en staging**, conservando
los códigos de barras SICAR, precio1, atributos y departamento/sección por variante.
No se fusionaron productos por nombre. Catálogo: **7,666 / 16,224 = 47.3%**;
quedan 8,558 filas (5,937 sólo SICAR y 2,621 restantes). Es cobertura de catálogo,
no porcentaje global de terminación.

Las 24 fichas nuevas tienen **95 fotos propias**, comprobadas por lectura y hash
de sus bytes. Las 7,513 variantes anteriores conservan UUID, objeto actual y
objeto de origen exactos. Las 1,461 fuentes y borradores web anteriores conservan
contenido, fotos, hash y revisión exactos. Repetición de carga: 0 creadas,
0 actualizadas y 153 sin cambios. Todo el catálogo fue auditado: 7,666 exactas,
0 diferencias. Cero saldos y cero movimientos de inventario.

## Protección nueva

`prepare-name-review.mjs` prepara evidencia sólo cuando el código base Woo es
literal, distinto y único globalmente, el destino tiene padres gestionados con
identidades distintas y las variantes son exactas. Conserva los controles de
dueños, taxonomía, estado publicado, exhibición, precio público y atributos.
Comprueba cada fila completa contra el corte SICAR verificado, sin alterar
el reporte canónico ni aprobar comercialmente la publicación.

`app.review_m9_names` es privado, SECURITY INVOKER, sólo operador postgres y
STAGING habilitado. Registra los casos concretos en `app.m9_name_reviews`, con
RLS habilitado y sin privilegios public/anon/authenticated/service_role. Exige:

- Identidad literal del candidato y de los pares del mismo nombre; bases
  globalmente únicas y ausencia de prefijos superpuestos con el candidato.
- Pares reales gestionados, con nombre correspondiente al origen; no habilita
  productos del mismo nombre sin vínculo gestionado.
- Huella vigente del contexto del destino: producto completo, vínculo gestionado
  y filas `current`/`stored` de sus variantes.
- Plan original con reserva de nombre y, después de registrar la evidencia,
  **plan completo sin ningún otro rechazo**. La segunda comprobación impide que
  una reserva de nombre oculte otro control del importador original.

`EXISTING_NAME_REQUIRES_IDENTITY_REVIEW` sigue bloqueando las filas sin evidencia.
Para un caso revisado, el plan exige igualdad JSON completa de la fila, incluyendo
todos los atributos anidados, contexto intacto y revisión de hasta 24 horas.
La huella del plan incorpora la tabla de revisiones. El aplicador bloquea esa
tabla junto con el catálogo y vuelve a planificar antes de escribir. No se cambian
los controles de códigos, atributos, secciones, identidad ni ediciones del destino.
No hay nuevo RPC público, permisos de envío o autorización de producción.

Una carga puede cambiar el contexto de sus propias revisiones al agregar padres
del mismo nombre. Es esperado: la evidencia no permite cargar después otras
variantes no revisadas. Una repetición de filas ya cargadas usa los controles
originales de identidad y fila guardada. Los casos del mismo nombre se planifican
juntos; aquí las 153 filas se aplicaron en un único lote.

## Migraciones y pruebas

Migraciones creadas con CLI y aplicadas exclusivamente a staging:

- `20261006234032_m9_protected_name_review.sql`.
- `20261006235131_m9_exact_name_review_rows.sql`.

La segunda fortalece la comprobación de fila: la contención JSON del primer
procedimiento podía aceptar un subconjunto de atributos. La revisión final lo
detectó y se corrigió mediante migración nueva, sin editar la ya aplicada. Las
153 filas efectivamente cargadas siempre fueron las filas completas del paquete
verificado; no se aplicó ningún subconjunto. Cinco regresiones SQL prueban igualdad
completa y rechazo de atributos parciales, campo ausente, precio distinto y campo
extra. Los cambios de contexto utilizados en esa prueba se revirtieron.

El ensayo inicial ejecutó 20 comprobaciones SQL en transacción revertida:
reserva original, contexto cambiado, identidad cambiada, taxonomía pendiente,
atomicidad, staging deshabilitado, registro idempotente, plan/token, aplicación
con token anterior, fila distinta, vencimiento, edición del destino, deshabilitado
con evidencia existente, carga de 153, repetición sin duplicados, cantidad,
inventario y privilegios/security invoker. El ensayo revierte catálogo y
existencias; PostgreSQL puede consumir seriales aun en rollback, como prevé la
regla de SKU. No se reciclan seriales ni se alteran etiquetas SICAR.

405 pruebas unitarias / 58 archivos y lint dirigido aprobados, incluidas seis
pruebas nuevas del preparador. Advisor final sin advertencias de las nuevas
funciones; INFO de RLS sin políticas en la tabla privada es intencional, porque
no tiene acceso de cliente. Las categorías de advertencias anteriores permanecen
fuera de esta modificación. Referencia del advisor:
https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Evidencia y siguientes pasos

`outputs/m9-nombres-protegidos-2026-10-06/` contiene las funciones originales,
contextos y paquete verificado, SQL de pruebas, registro, plan vigente, aplicación,
repetición, snapshot completo, auditorías y preservación. `corrida-1/2`,
`fichas/fichas-repeticion`, `auditoria-1/2` y `familias-1/2` son pares idénticos.
`galerias.json` y `auditoria-fotos.json` cubren exactamente las 95 fotos; no hay
faltantes ni extras. `cierre.json` y `sha256-ejecucion.json` resumen la evidencia.
`reporte.html` muestra el avance sencillo y enlaza las dudas consolidadas.

Familias actualizadas: 1,486 padres gestionados, 910 estructuralmente completos,
576 con variaciones Woo faltantes, 0 inesperadas y 52 con departamentos mezclados
como observación (no error supuesto). Las 1,666 variaciones faltantes carecen de
fila SICAR confirmada; no se inventan códigos. Fuentes: 1,485; borradores: 1,486
(incluye sintético); vínculos de categorías: 1,238 válidos, cero invalidados.
Las colas siguen en 3 remotas / 1 galería / 9 locales. Sin nueva activación de envío.

Woo continúa siendo el corte autenticado histórico del 1 de octubre; no es
verificación actual de precios, fotos o estados. Las categorías de los nuevos
24 productos siguen pendientes: no se amplió la consulta pública autorizada
para los 1,240 IDs anteriores. Los amartigones no se habilitan para compra;
su política de exhibición debe conservarse antes de cualquier envío futuro.

Siguiente bloque: revisión agrupada de las 5,937 filas sólo SICAR y de las
identidades ambiguas, conservando pendiente CAWRNIÑO3587. Las dudas de negocio
siguen juntas: clasificación en 86 registros, precio en 40 e identidad repetida
en 62, con solapamientos. No equivalen a miles de preguntas individuales.

No se modificó Woo de producción/pruebas, no se importaron existencias, no hubo
pedidos, merge ni despliegue frontend. Sólo se aplicaron las migraciones y cargas
supervisadas de staging. Sol6.1 sigue siendo suficiente para este trabajo;
recomendar Astra antes de pedidos, devoluciones, inventario central o auditoría
final de operación real.
