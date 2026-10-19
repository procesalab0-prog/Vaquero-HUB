# M9 — Propuesta para agilizar la migración con menos preguntas

19 de octubre de 2026. Preparada por Claude Code a petición de Emmanuel, para
que Codex la evalúe antes de seguir con M9. **Es una propuesta, no un cambio
autorizado**: no modifica código, base de datos, staging, producción ni Woo.
Las reglas que se proponen cambiar las fijó el propio flujo de M9; cambiarlas
requiere la autorización explícita de Emmanuel registrada en el Registro vivo.

## Diagnóstico

Cifras tomadas de los documentos de `codex/m9-staging-review` (6–7 de octubre;
`M9_META_COBERTURA.md`, `M9_REVISION_PENDIENTE_COMPLETO.md`,
`M9_PREGUNTAS_POR_TANDAS.md`, `M9_PREGUNTAS_MAIN.md`). Hay que recalcularlas
contra el corte vigente antes de actuar.

- Catálogo cargado en staging: **7,709 / 16,224 = 47.516 %**, sin avance desde el
  6 de octubre. Producción no tiene catálogo migrado.
- Pendientes: **8,515** códigos, en tres grupos:

| Grupo | Códigos | Situación |
| --- | --- | --- |
| Sólo SICAR con delimitador literal `T.` | 1,322 | 303 preguntas reservadas; 302 sin observaciones técnicas (966 códigos) |
| Sólo SICAR sin separar modelo y talla | 4,615 | Sin pregunta ni regla |
| Revisión contra Woo (identidad, conflicto, base duplicada, etc.) | 2,578 | Expedientes técnicos |

- La cobertura depende de respuestas caso por caso: tandas de 10, sin abrir la
  siguiente mientras quede una pendiente o «No lo sé todavía», y cada respuesta
  afirmativa sólo genera una plantilla `pending` que después pasa por revisión
  técnica, plan y ensayo. A ese ritmo las 303 preguntas son ~31 tandas y cubren
  el 6 % del catálogo; 7,193 códigos no tienen siquiera un camino de pregunta.
- La regla «no se interpreta silencio ni confirmación general como aprobación»
  (`M9_META_COBERTURA.md`) es la que convierte cada familia en una pregunta.

## Hecho técnico que lo permite

En `main`, todo el historial operativo se guarda por variante, no por producto:
`sale_items`, saldos y movimientos de inventario, conteos, traspasos,
devoluciones, compras y cotizaciones referencian `public.variants(id)`. Por lo
tanto, mover una variante a otro producto padre no pierde ventas, existencias
ni historial, siempre que se conserve el `variant_id`. **Codex debe verificarlo**,
incluidas las protecciones de campos de migración
(`20260902023516_m2_proteger_campos_de_migracion.sql`), índices únicos de
nombre/padre y cualquier lectura que agrupe por `product_id`.

## Propuestas, por impacto

### 1. Cargar para vender, agrupar después

Separar dos metas que hoy van juntas:

- **Operar** (escanear, cobrar, contar, traspasar) sólo necesita código literal,
  descripción, precio1 y sección/departamento de SICAR.
- **Agrupar** en modelo + talla sólo hace falta para la web y para reportes por
  modelo.

Propuesta: cada código pendiente se carga como **producto provisional de una
sola variante**, con la Clave 1 literal, descripción SICAR completa, precio1,
departamento y sección, marcado como agrupación pendiente (por ejemplo
`grouping_status = 'PROVISIONAL'` o la marca equivalente que Codex prefiera).
Sin existencias inventadas: las existencias entran por el procedimiento de
corte, igual que para lo ya conciliado. No se publica en Woo.

Después, una herramienta **«Agrupar en modelo»** (gerencia, auditada) mueve
variantes provisionales a un padre, asignando la talla, sin cambiar
`variant_id`, códigos ni historial. Así las preguntas dejan de bloquear el
cambio de SICAR al sistema nuevo: se resuelven después, con la tienda ya
operando.

Riesgos que Codex debe cubrir: duplicados al agrupar, búsquedas que muestren el
mismo modelo varias veces mientras sea provisional, reportes por modelo
incompletos hasta agrupar, y que la web no publique provisionales.

### 2. Aprobar por regla y por muestra, no caso por caso

Pedir a los dueños **una sola regla** para los 302 casos limpios con `T.`:

> Si la descripción SICAR trae `T.` + talla, y el resto de la descripción,
> precio1, departamento y sección coinciden, es el mismo modelo y sólo cambia
> la talla.

Validación: mostrar ~20 familias elegidas al azar (semilla registrada) dentro
de los 302. Si los dueños confirman todas, la regla se aplica a los 302 (966
códigos) en un solo lote, que pasa por el mismo plan, ensayo con rollback,
carga y auditoría de siempre. Las familias con observaciones, CAWRNIÑO3587 y
cualquier caso que los dueños marquen siguen como preguntas individuales.

Resultado esperado: cobertura de ~47.5 % a ~53.5 % con una respuesta en lugar
de 30 tandas. Requisito: que el planificador acepte una **decisión por regla**
con su evidencia (regla, muestra, respuestas, huella del conjunto), en lugar de
exigir revisor por familia. Mismo patrón para reglas futuras (por ejemplo
talla × largo ya confirmada como `CONFIRMED_SIZE_X_LENGTH`).

### 3. Migrar sólo lo que importa

Con un reporte de SICAR de existencias por sucursal y ventas de los últimos 12
meses, clasificar los 8,515 pendientes:

- Con existencia o venta reciente: migrar (por la vía 1 o 2).
- Sin existencia y sin ventas: **archivar** (consultables por código si
  reaparecen, sin carga ni pregunta).

No hay medición todavía; es probable que una parte grande de los 4,615 sin
separar caiga aquí. Hay que medirlo antes de preguntar nada más.

### 4. Separar la web del cambio de sistema

Los 2,578 en revisión contra Woo frenan sobre todo la ficha web. Para operar la
tienda basta la identidad SICAR (vía 1). Conciliar con Woo puede seguir después
del cambio, sin bloquear la operación.

### 5. Que contestar cueste menos

Para lo que sí necesite pregunta:

- Tandas de hasta 50 en forma de lista, con «Todo correcto en esta página» y
  marcar sólo excepciones.
- «No lo sé todavía» se aparta a una lista propia y **no bloquea** la siguiente
  tanda.
- Mejor una sesión de una hora con los dueños (en persona o por videollamada,
  con el agente preparando las tandas en vivo) que tandas sueltas durante semanas.

### 6. Corregir en el origen

Los dueños ya corrigieron en SICAR (cintos 18057/18058, Nokota 11201/3280).
Falta una exportación SICAR nueva para verificarlo. Si además adoptan una
convención fija para la talla en la descripción (por ejemplo siempre `T. 27`),
una parte de los 4,615 sin separar pasa a la regla de la vía 2 sin preguntas.

## Lo que no cambia

- Clave 1 literal, sin deducir tallas de números finales ni inventar códigos.
- Sin existencias inventadas, sin costos inventados, sin compra de amartigones.
- Plan, ensayo con rollback, carga y auditoría reproducibles con huellas.
- Staging primero; producción y Woo real sólo con autorización explícita.
- RLS y autorización en servidor; acciones de agrupación sólo gerencia y
  auditadas.

## Orden sugerido para Codex

1. Verificar el hecho técnico (variante como llave del historial) y responder
   si la vía 1 es viable con el esquema actual o qué falta.
2. Pedir a SICAR los reportes de existencias y ventas, y medir la vía 3.
3. Preparar la decisión por regla de la vía 2 con su muestra de ~20 familias,
   para que Emmanuel la presente a los dueños.
4. Diseñar la carga provisional y «Agrupar en modelo» (vía 1) en staging, con
   pruebas SQL de que agrupar conserva `variant_id`, ventas, saldos y auditoría.
5. Ajustar la bandeja de preguntas (vía 5) sólo para lo que siga necesitando
   una persona.

## Decisiones que necesita Emmanuel

- ¿Autoriza cargar códigos como productos provisionales para operar antes de
  agruparlos (vía 1)?
- ¿Autoriza aprobar por regla + muestra la regla `T.` (vía 2), sustituyendo
  la regla de no aceptar confirmaciones generales para esos casos?
- ¿Autoriza archivar lo que no tenga existencia ni ventas en 12 meses (vía 3)?
- ¿Puede conseguir de SICAR los reportes de existencias y ventas, y una
  exportación nueva del catálogo?
