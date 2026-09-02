# Cola de trabajo

> Qué implementar y en qué orden. Este documento se toma de arriba hacia
> abajo: lo primero sin bloquear es lo siguiente que se hace.
>
> Para entender el proyecto antes de tocarlo, empezar por
> [`ESTADO_Y_CONTINUIDAD.md`](ESTADO_Y_CONTINUIDAD.md).
>
> Última actualización: 2026-09-02, tras revisar el generador de identidad.

## Cómo usar esta cola

- **Una tarea a la vez**, de arriba hacia abajo, saltando lo bloqueado.
- Cada tarea es su propia rama y su propio PR.
- La especificación manda. Si está mal, se corrige en un PR aparte
  **antes** de implementar contra ella; no se interpreta sobre la marcha.
- Si falta una regla de negocio, **no se inventa**: se implementa lo que sí
  está definido y se deja el resto fuera del PR, marcado como bloqueado.
- Al terminar una tarea, se marca aquí.

## Regla nueva, salida de la revisión de M2

**Los campos de aterrizaje de la migración sólo los escribe el importador
de M9: `legacy_sicar_code`, `woocommerce_product_id`,
`woocommerce_variation_id`, y un código de barras con `source = 'SICAR'`.
Nunca el alta manual, nunca la interfaz.**

El motivo no es de estilo. Esos cuatro son inmutables por diseño una vez
escritos, así que un valor puesto por error queda permanente. La cadena
completa quedó comprobada: cualquier usuario con `products.create` podía
reservar un código de SICAR meses antes del corte, el disparador impedía
corregirlo, y al correr la migración real esa fila la tumbaba con
violación de unicidad sin forma de arreglarla. El evento más delicado del
proyecto quedaba a merced de un dato que alguien tecleó sin saber.

Ya está cerrado en la migración `20260902170000`. Si aparece una función
nueva que escriba en catálogo, aplica la misma regla.

**Antes de dar por buena esta parte, hay que revisar staging y producción:**
si alguien ya creó variantes con `legacy_sicar_code` a través de la
interfaz, esas filas están envenenadas y el código no se puede corregir.
Conviene limpiarlas **ahora**, mientras M3 no existe y por lo tanto ninguna
variante tiene movimientos de inventario todavía. Después ya no será
posible borrarlas sin romper historial.

```sql
select id, sku, legacy_sicar_code from public.variants
where legacy_sicar_code is not null;
select code, source from public.barcodes where source = 'SICAR';
```

Ambas consultas deben devolver cero filas hasta que corra la migración
real de SICAR.

## Regla nueva, salida de la revisión del generador

**Dentro de un producto no puede haber dos variantes con el mismo conjunto
de atributos.** Ni activas ni dadas de baja: el artículo físico es el mismo.

Conviene entender por qué apareció justo al mejorar las cosas, porque es el
mismo patrón que ya salió tres veces en este proyecto —_algo que parecía
proteger y no protegía_—, sólo que al revés: aquí algo protegía sin que
nadie lo hubiera decidido, y la mejora se lo llevó.

Antes, quien llamaba mandaba el código de barras. Dos renglones con la misma
talla y el mismo color chocaban contra la unicidad de `barcodes.code` y el
alta entera se caía. Nadie había escrito una regla sobre combinaciones
repetidas; sólo sobre códigos repetidos. Al generar ahora una identidad nueva
por renglón, los duplicados reciben SKU y código distintos **y el alta pasa
sin ruido**.

Queda comprobado: un alta con la misma talla dos veces creaba dos variantes,
`1000008-1` y `1000009-9`, cada una con su código. El mismo par de botas con
dos identidades, la existencia partida entre las dos, y un escaneo que cae en
una o en otra según qué etiqueta se pegó en la caja. El inventario por talla
—la razón de ser del proyecto— deja de cuadrar sin que nadie lo note, y se
descubre meses después contando físicamente.

Cerrado en `20260902041500` con restricciones diferidas. Tres consecuencias
para quien siga:

- **La deduplicación de la pantalla no cuenta como control.** La carga masiva
  de M2.4 y el importador de M9 entran por la misma función sin pasar por la
  interfaz.
- **El error llega como `DUPLICATE_VARIANT_ATTRIBUTES`**, no traducido a
  `CATALOG_DUPLICATE_VALUE`: la restricción es diferida y salta al cerrar la
  transacción, ya fuera del `exception` de `create_catalog_product`. Toda
  pantalla nueva tiene que atender ese nombre.
- Un producto **sí** puede tener una variante sin atributos —una hebilla, un
  accesorio sin variaciones—, pero **una sola**.

**Y una advertencia sobre lo que la migración no hace:** las restricciones
diferidas sólo revisan lo que se escribe de ahora en adelante. Si en staging
o producción ya se crearon duplicados con la versión anterior, ahí siguen.
Conviene buscarlos **ahora**, mientras M3 no existe y ninguna variante tiene
movimientos de inventario:

```sql
select p.name, count(*) as variantes_repetidas
from public.variants v
join public.products p on p.id = v.product_id
group by p.id, p.name, (
  select coalesce(string_agg(va.type_code || '=' || va.value_id::text, '|'
                             order by va.type_code), '')
  from public.variant_attributes va where va.variant_id = v.id)
having count(*) > 1;
```

Cero filas es lo esperado. Si sale alguna, se borra la variante duplicada
más nueva antes de que tenga historial; después ya no se podrá.

## Regla del importador de M9, salida de la misma revisión

**El importador de SICAR no inventa SKU: los toma de
`app.variant_serial_seq`, igual que el alta manual.** El código de SICAR
viaja aparte, en `legacy_sicar_code`.

`service_role` puede escribir en `variants` directamente y la restricción de
formato sólo exige que el SKU sea un número con verificador válido — no que
venga de la secuencia. Comprobado: un `insert` con SKU `2000000-6` pasa sin
problema. La colisión queda programada para el día que la secuencia llegue a
ese número, meses después, sin relación aparente con la migración que la
causó. Aplica igual a cualquier guion de respaldo o reparación.

## Integrado en esta entrega

- Acceso del cliente sin adivinar el destino. Ya se configuró
  `CUSTOMER_APP_URL=https://vaquero-hub.vercel.app/mi` en producción.
- Cierre de seguridad de M1B: anonimización y límite de acceso por origen.
- Especificaciones de M4 y M5 y documentos de continuidad.
- Primera entrega de M2: esquema, alta atómica de producto con variantes,
  búsqueda real y pantalla conectada a Supabase.
- Segunda entrega de M2: campos de SICAR reservados a M9, SKU con dígito
  verificador, EAN-13 generado en base de datos y matriz color × talla
  editable antes de guardar.
- Revisión del generador: una sola variante por combinación de atributos,
  con las diez pruebas obligatorias de `specs/CODIGOS_Y_SKU.md` ejecutadas
  contra un PostgreSQL real.

---

## 1. M2.2 — Alta de catálogo y generador de variantes

**Especificación:** [`specs/M2_CATALOGO.md`](specs/M2_CATALOGO.md) §3
**Estado:** alta y agregado de variantes terminados; falta edición.

Es la función que resuelve el dolor que originó el proyecto: dar de alta
una bota con ocho tallas sin capturar ocho veces.

Qué construir:

- Ya existen `create_catalog_product(...)` para el alta atómica y
  `add_variants_to_product(...)` para ampliar un producto sin recrearlo.
  Falta completar edición.
- Funciones `SECURITY DEFINER` en `public` para editar
  marcas, categorías, productos y variantes. Todas validan permisos
  explícitamente (`products.create`, `products.update`,
  `products.price_update`), porque al ser definer se saltaron la RLS.
- El alta recibe los datos del padre y una matriz talla × color editable, y
  crea producto, variantes, SKU y códigos en **una sola transacción**.
- `add_variants_to_product(...)`: agregar tallas después **sin tocar ni
  recrear** las variantes existentes, que ya tienen historial.
- **Generador de código y SKU terminado en 0.11.0.** La interfaz ya no puede
  mandar identidades, códigos SICAR ni IDs de WooCommerce. Una secuencia
  privada produce el SKU con verificador y el EAN-13 dentro de la transacción.

  **Especificación completa:** [`specs/CODIGOS_Y_SKU.md`](specs/CODIGOS_Y_SKU.md).
  Lo esencial: una sola secuencia interna de la que salen el SKU y el
  código de barras, para que no se desincronicen; y dígito verificador en el
  SKU porque alguien lo va a teclear y un error de dedo no debe caer en otro
  artículo. **No se enciende la generación en producción** hasta comprobar
  contra la exportación de muestra que ningún código heredado empieza con
  el prefijo elegido (sección 8 de esa especificación).

  Verificado el 2026-09-02 contra un PostgreSQL real, las diez pruebas de la
  sección 10 de esa especificación. Pasan las diez; la 9 y la 10 pasan desde
  la corrección de `20260902041500`.

**Ojo con esto:** el generador emite EAN-13 con prefijo `20`, y ese formato
quedó escrito en **tres lugares** —el generador, `app.is_valid_generated_barcode`
y la restricción `barcodes_generated_identity_check`—, no detrás de una
constante como decía la especificación. No es un defecto: EAN-13 es la opción
recomendada. Pero sí cambia el cálculo. Si la respuesta a la pregunta 1.1 de
`PREGUNTAS_CLIENTE.md` llega y dice Code128, son tres cambios coordinados **y
los códigos ya generados se quedan en EAN-13 para siempre**, porque son
inmutables.

Por eso **la compuerta es ahora la única mitigación**: no se genera un solo
código en producción antes de comprobar contra la exportación de muestra de
SICAR que ningún código heredado de 13 dígitos empieza con `20`–`29`
(sección 8 de `specs/CODIGOS_Y_SKU.md`).

Criterios: pruebas 1, 3 y 6 de la especificación. La 3 —alta de una bota
con ocho tallas en menos de un minuto— se cronometra con una persona, no
con un script.

### Lo siguiente de M2.2, en este orden

1. **Terminado en 0.12.0: `add_variants_to_product(product_id, variants)`.** Agrega tallas o
   colores después **sin tocar ni recrear** las variantes existentes, que ya
   tienen historial. Toma serial de la misma secuencia y hereda las mismas
   reglas del alta: no acepta identidades del cliente, y la combinación
   repetida la rechaza la restricción diferida — que también sirve aquí sin
   escribir nada nuevo, porque cuelga de las tablas, no de la función.

   La prueba que importa quedó automatizada: agregar la talla 29 a una bota
   que ya tiene ocho tallas **no cambia el SKU ni el código de ninguna de las
   ocho**. La función y la restricción usan el mismo candado transaccional por
   producto, por lo que dos altas simultáneas tampoco pueden confirmar la
   misma combinación.

2. **Siguiente: `register_variant_barcode(variant_id, code, symbology, source)`.** Hoy
   no hay forma de dar de alta un código que no salga del generador, y la
   especificación pide dos casos que quedaron sin ruta:

   - **Código de proveedor** (sección 6): se adopta sólo si es **distinto
     para cada talla**. La trampa del calzado es real y hay que verificarla
     caja por caja: varios fabricantes imprimen el mismo código para todas
     las tallas de un modelo, y adoptarlo tira el inventario por talla.
   - **Reemitir** (sección 7): un código mal impreso **no se corrige**, se
     agrega otro y se marca primario; el anterior sigue escaneando porque ya
     está pegado en cajas. El esquema lo permite —`barcodes` admite varios
     por variante con un único primario— y el disparador deja bajar el
     primario anterior. Falta la función.

   Va con permiso `products.update` y **rechaza `source = 'SICAR'`**: ese
   valor es sólo del importador de M9, igual que `legacy_sicar_code`.

3. **Edición de producto y variante.** Funciones `SECURITY DEFINER` en
   `public` que validan permiso explícitamente, porque al ser definer se
   saltaron la RLS. Recordar que el SKU y los códigos generados son
   inmutables: la edición toca nombre, marca, categoría, precio y estado.

**Un artículo sin color no se puede dar de alta desde la pantalla.** La
matriz exige al menos un color y al menos una talla, y la base ya acepta una
variante sin atributos. Para sombreros, cinturones y accesorios que no se
venden por color eso es un hueco real; conviene resolverlo cuando lleguen las
escalas de talla que faltan (preguntas 1.3 y 1.4).

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

| Qué                                                 | Qué falta saber                                  |
| --------------------------------------------------- | ------------------------------------------------ |
| Escalas de talla de sombreros, texanas y cinturones | Preguntas 1.3 y 1.4. Por eso se sembraron vacías |
| Simbología del código de barras                     | Pregunta 1.1                                     |
| Motor de puntos, redención, cumpleaños, niveles     | Sección 6 completa                               |
| Crédito a clientes                                  | Pregunta 5.2                                     |
| Apartados: plazo, enganche, vencimiento             | Pregunta 5.1                                     |
| Envío de tickets por SMS o correo                   | Pregunta 3.5                                     |
| Costo de compra: promedio ponderado o último        | Pregunta 4.1                                     |

## Deuda pendiente

| Qué                                                                                       | Dónde              |
| ----------------------------------------------------------------------------------------- | ------------------ |
| Hacer recuperable el borrado de Auth si falla después de anonimizar la fila del cliente   | Seguimiento de M1B |
| Mudar la PWA de clientes a subdominio propio; actualizar `CUSTOMER_APP_URL` cuando exista | Issue #8           |
| Las specs describen construir pantallas que ya existen en la interfaz 0.6.2               | Issue #4           |
| El plan maestro no incluye el catálogo de los 19 requerimientos del cliente               | Issue #3           |

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
