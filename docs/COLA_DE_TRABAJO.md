# Cola de trabajo

> Qué implementar y en qué orden. Este documento se toma de arriba hacia
> abajo: lo primero sin bloquear es lo siguiente que se hace.
>
> Para entender el proyecto antes de tocarlo, empezar por
> [`ESTADO_Y_CONTINUIDAD.md`](ESTADO_Y_CONTINUIDAD.md).
>
> Última actualización: 2026-09-01.

## Cómo usar esta cola

- **Una tarea a la vez**, de arriba hacia abajo, saltando lo bloqueado.
- Cada tarea es su propia rama y su propio PR.
- La especificación manda. Si está mal, se corrige en un PR aparte
  **antes** de implementar contra ella; no se interpreta sobre la marcha.
- Si falta una regla de negocio, **no se inventa**: se implementa lo que sí
  está definido y se deja el resto fuera del PR, marcado como bloqueado.
- Al terminar una tarea, se marca aquí.

## Integrado en esta entrega

- Acceso del cliente sin adivinar el destino. Ya se configuró
  `CUSTOMER_APP_URL=https://vaquero-hub.vercel.app/mi` en producción.
- Cierre de seguridad de M1B: anonimización y límite de acceso por origen.
- Especificaciones de M4 y M5 y documentos de continuidad.
- Primera entrega de M2: esquema, alta atómica de producto con variantes,
  búsqueda real y pantalla conectada a Supabase.

---

## 1. M2.2 — Alta de catálogo y generador de variantes

**Especificación:** [`specs/M2_CATALOGO.md`](specs/M2_CATALOGO.md) §3
**Estado:** parcialmente terminado en la primera entrega de M2.

Es la función que resuelve el dolor que originó el proyecto: dar de alta
una bota con ocho tallas sin capturar ocho veces.

Qué construir:

- Ya existe `create_catalog_product(...)` para el alta atómica de un producto
  con múltiples tallas. Falta completar edición y `add_variants_to_product`.
- Funciones `SECURITY DEFINER` en `public` para editar
  marcas, categorías, productos y variantes. Todas validan permisos
  explícitamente (`products.create`, `products.update`,
  `products.price_update`), porque al ser definer se saltaron la RLS.
- El alta existente recibe los datos del padre más las tallas elegidas y crea
  producto y variantes en **una sola transacción**. Falta la matriz talla ×
  color de la especificación completa.
- `add_variants_to_product(...)`: agregar tallas después **sin tocar ni
  recrear** las variantes existentes, que ya tienen historial.
- Falta automatizar la generación del SKU interno y del código de barras.
- Interfaz: matriz talla × color **editable antes de guardar**, porque no
  todo color viene en todas las tallas.

**Ojo con esto:** la simbología del código de barras para productos
nuevos depende de qué imprime SICAR hoy (pregunta 1.1 de
`PREGUNTAS_CLIENTE.md`). Mientras no haya respuesta, generar Code128 y
dejar la elección detrás de una constante de configuración fácil de
cambiar. **No** rediseñar el esquema cuando llegue la respuesta.

Criterios: pruebas 1, 3 y 6 de la especificación. La 3 —alta de una bota
con ocho tallas en menos de un minuto— se cronometra con una persona, no
con un script.

## 2. M2.3 — Búsqueda y listado de catálogo

**Especificación:** [`specs/M2_CATALOGO.md`](specs/M2_CATALOGO.md) §7

- **Estado:** primera versión terminada y conectada a `search_catalog`.
- Búsqueda por código escaneado (exacta contra `barcodes.code`), por
  texto tolerante a acentos, y por código parcial.
- **Un solo campo**: quien busca teclea o escanea y el sistema decide qué
  es. Obligar a elegir el criterio antes de escribir es un paso de más en
  el peor momento.
- **Resultados agrupados por producto padre**, mostrando las tallas
  disponibles. No una lista plana de dieciséis renglones: ésa es la
  diferencia entre una búsqueda usable y una que frustra.

**Recordatorio del esquema:** `cost_cents` está fuera del permiso de
columnas, así que toda consulta a `variants` debe nombrar sus columnas.
`select *` falla. No abrir la columna para "arreglarlo".

## 3. M2.4 — Carga masiva

**Especificación:** [`specs/M2_CATALOGO.md`](specs/M2_CATALOGO.md) §4

Requisito duro: **valida todo antes de escribir nada.** Corre en seco,
devuelve un reporte, y sólo si el usuario lo acepta escribe — dentro de
una transacción, todo o nada.

Detecta como mínimo: códigos duplicados dentro del archivo, códigos que ya
existen, códigos vacíos, ceros iniciales perdidos, espacios accidentales,
categorías o marcas inexistentes, precios no numéricos, y tallas que no
pertenecen a la escala de la categoría.

Este validador **comparte núcleo con el sincronizador de SICAR (M9)**. Es
el mismo problema en dos momentos distintos: conviene escribirlo una vez.

## 4. M2.5 — Etiquetas

**Especificación:** [`specs/M2_CATALOGO.md`](specs/M2_CATALOGO.md) §6

- Plantillas guardadas como registros editables, no fijas en el código.
- Impresión masiva desde una selección.
- **Las etiquetas se imprimen desde una computadora de trastienda, no
  desde el iPad.** El iPad imprime tickets; el etiquetado ocurre al
  recibir mercancía, no en la caja.

## 5. M3 — Inventario, movimientos y traspasos

**Especificación:** [`specs/M3_INVENTARIO.md`](specs/M3_INVENTARIO.md)
**Depende de:** M2.2, porque el inventario cuelga de `variants`.

El de mayor riesgo técnico del proyecto. Un error aquí no se ve: aparece
meses después como un inventario que no cuadra y que nadie sabe explicar.

Las tres pruebas bandera: dos ventas concurrentes sobre existencia 1 (con
conexiones paralelas de verdad, no llamadas en serie); la invariante de
que la suma de movimientos iguala el saldo; y que la mercancía en tránsito
no aparezca disponible en ninguno de los dos extremos.

## 6. M4 — POS, pagos mixtos y caja

**Especificación:** [`specs/M4_POS_Y_CAJA.md`](specs/M4_POS_Y_CAJA.md)
**Depende de:** M3.

**Publicar la firma de `create_sale` antes de implementarla.** Es lo que
desbloquea el trabajo en paralelo cuando el equipo se divida
([`REPARTO_TRABAJO.md`](REPARTO_TRABAJO.md) §3.2).

La regla que gobierna: el cliente nunca dice cuánto cuesta algo.

## 7. M5 — Devoluciones y cambios

**Especificación:** [`specs/M5_DEVOLUCIONES_Y_CAMBIOS.md`](specs/M5_DEVOLUCIONES_Y_CAMBIOS.md)
**Depende de:** M4.

## 8. M9 — Importador y sincronizador de SICAR

**Especificación:** [`PLAN_CODEX.md`](PLAN_CODEX.md) §5, milestone M9
**BLOQUEADO:** hace falta una exportación de muestra de SICAR.

El script de análisis —que sólo lee y reporta— se puede escribir en cuanto
llegue el archivo, y de él sale la lista de limpieza que el cliente
trabaja durante semanas. Conviene adelantarlo apenas se pueda.

---

## Bloqueado por el cliente

No se empieza hasta tener respuesta. Todas están en
[`PREGUNTAS_CLIENTE.md`](PREGUNTAS_CLIENTE.md).

| Qué | Qué falta saber |
|---|---|
| Escalas de talla de sombreros, texanas y cinturones | Preguntas 1.3 y 1.4. Por eso se sembraron vacías |
| Simbología del código de barras | Pregunta 1.1 |
| Motor de puntos, redención, cumpleaños, niveles | Sección 6 completa |
| Crédito a clientes | Pregunta 5.2 |
| Apartados: plazo, enganche, vencimiento | Pregunta 5.1 |
| Envío de tickets por SMS o correo | Pregunta 3.5 |
| Costo de compra: promedio ponderado o último | Pregunta 4.1 |

## Deuda pendiente

| Qué | Dónde |
|---|---|
| Hacer recuperable el borrado de Auth si falla después de anonimizar la fila del cliente | Seguimiento de M1B |
| Mudar la PWA de clientes a subdominio propio; actualizar `CUSTOMER_APP_URL` cuando exista | Issue #8 |
| Las specs describen construir pantallas que ya existen en la interfaz 0.6.2 | Issue #4 |
| El plan maestro no incluye el catálogo de los 19 requerimientos del cliente | Issue #3 |

## Antes de dar por terminada cualquier tarea

- [ ] Migración versionada que aplica limpio sobre base vacía.
- [ ] RLS activo en toda tabla nueva, con prueba de que un rol sin permiso
      no puede leer ni escribir.
- [ ] Pruebas de la lógica crítica: dinero, inventario, caja.
- [ ] `format:check`, `lint`, `typecheck`, `build` y la suite en verde.
- [ ] Sin secretos en el diff.
- [ ] El PR responde qué se modificó, por qué, riesgos, pruebas,
      migraciones e impacto.

Y una pregunta encima de todo, porque tres hallazgos de la auditoría
fueron exactamente de ese tipo: **¿este control de verdad hace lo que
dice?** Que el código exista no significa que funcione.
