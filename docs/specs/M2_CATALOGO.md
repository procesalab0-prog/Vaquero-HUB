# M2 — Catálogo: productos, variantes y códigos

> Especificación para Codex. Ver [`../PLAN_CODEX.md`](../PLAN_CODEX.md)
> para las reglas generales.
>
> Este milestone resuelve el problema que originó el proyecto: **dar de
> alta una bota con ocho tallas sin capturar ocho veces.** Si al final de
> M2 eso no se siente rápido, el milestone no está terminado por más que
> las pruebas pasen.

## 1. Modelo de datos

### 1.1 Producto padre y variante

```sql
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  brand_id     uuid references public.brands(id),
  category_id  uuid not null references public.categories(id),
  description  text,
  is_active    boolean not null default true,
  created_by   uuid references public.app_users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.variants (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references public.products(id),
  sku                text not null unique,
  cost_cents         bigint not null default 0 check (cost_cents >= 0),
  price_cents        bigint not null default 0 check (price_cents >= 0),

  -- Aterrizaje de la migración. Se crean ahora, se llenan mucho después.
  legacy_sicar_code       text unique,
  woocommerce_product_id  bigint,
  woocommerce_variation_id bigint unique,

  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

El producto padre **no tiene precio ni existencia**. Todo el dinero y todo
el inventario viven en la variante. El padre agrupa y da nombre.

### 1.2 Los códigos heredados son inmutables

La regla 1 del contexto maestro se implementa como disparador, no como
buena intención:

```sql
create or replace function app.fn_protect_legacy_codes()
returns trigger language plpgsql as $$
begin
  if old.legacy_sicar_code is not null
     and new.legacy_sicar_code is distinct from old.legacy_sicar_code then
    raise exception 'LEGACY_CODE_IMMUTABLE';
  end if;
  return new;
end $$;

create trigger variants_protect_legacy_codes
before update on public.variants
for each row execute function app.fn_protect_legacy_codes();
```

Una vez que un código de SICAR aterriza en una variante, **nadie lo
cambia**: ni un administrador, ni la interfaz, ni un script. Es el puente
entre la tienda física, Vaquero Hub y WooCommerce.

### 1.3 Atributos: talla, color y lo que venga

```sql
create table public.attribute_types (
  code          text primary key,   -- 'TALLA','COLOR','ANCHO'
  name          text not null,
  display_order int not null default 0
);

create table public.attribute_values (
  id            uuid primary key default gen_random_uuid(),
  type_code     text not null references public.attribute_types(code),
  scale_code    text references public.size_scales(code),
  value         text not null,
  display_order numeric not null default 0,
  unique nulls not distinct (type_code, scale_code, value)
);

create table public.variant_attributes (
  variant_id uuid not null references public.variants(id) on delete cascade,
  type_code  text not null references public.attribute_types(code),
  value_id   uuid not null references public.attribute_values(id),
  primary key (variant_id, type_code)
);
```

La llave primaria `(variant_id, type_code)` impide que una variante tenga
dos colores. Parece obvio hasta que alguien lo permite.

**`display_order` es `numeric` y no es opcional.** Las tallas son texto
(`'25'`, `'25.5'`, `'CH'`, `'XG'`) y ordenarlas alfabéticamente pone la
10 antes de la 9 y la 25.5 después de la 26. Todo listado de tallas ordena
por `display_order`, nunca por el texto.

### 1.4 Escalas de talla

Una bota no usa la misma escala que una camisa ni que un sombrero:

```sql
create table public.size_scales (
  code text primary key,     -- 'CALZADO_MX','ROPA_LETRA','SOMBRERO','CINTO'
  name text not null
);
```

Y `categories` lleva `default_size_scale_code`. Así, al crear un producto
en la categoría Botas, el generador ya ofrece 25, 25.5, 26… sin que nadie
lo elija.

Escalas iniciales a sembrar:

| Escala | Valores |
|---|---|
| `CALZADO_MX` | 22 a 31, en medias tallas |
| `ROPA_LETRA` | CH, M, G, XG, XXG |
| `ROPA_NUMERO` | 28 a 44, pantalones |
| `SOMBRERO` | por definir con el cliente |
| `CINTO` | por definir con el cliente |
| `UNITALLA` | valor único, para bolsas y carteras |

`UNITALLA` existe para que una bolsa siga siendo una variante y el sistema
no tenga dos caminos distintos según si el producto tiene tallas o no.

### 1.5 Códigos de barras

```sql
create table public.barcodes (
  id         uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.variants(id),
  code       text not null unique,
  symbology  text not null,     -- 'EAN13','CODE128','LEGACY'
  source     text not null,     -- 'SICAR','GENERATED','MANUAL','SUPPLIER'
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index on public.barcodes (variant_id) where is_primary;
```

Tabla aparte y no una columna, porque **una variante puede tener varios
códigos**: el del fabricante, el que imprime la tienda, y el heredado de
SICAR. Escanear cualquiera de ellos debe encontrar la misma variante.

`code` es único global: dos variantes no pueden compartir código. Ése es
el caso de prueba «código duplicado» de la sección 42 del contexto
maestro.

`barcodes` es el único hogar de todo código físico, incluidos los de
SICAR (`source = 'SICAR'`). Un disparador impide cambiar o borrar `code` y
`variant_id` cuando el origen es SICAR. No existe una segunda copia en
`variants`, porque dos fuentes de verdad acabarían divergiendo.

## 2. Generación de códigos para productos nuevos

**Decisión pendiente, y depende del ensayo 1 del runbook:** hay que ver
qué simbología imprime SICAR hoy antes de elegir.

| Opción | A favor | En contra |
|---|---|---|
| **EAN-13 con prefijo interno** (rango 20–29, reservado para uso en tienda) | Lo lee cualquier lector, incluso láser barato. Dígito verificador incluido. Encaja en plantillas de etiqueta estándar | Sólo numérico, 13 dígitos fijos |
| **Code128** | Alfanumérico, longitud libre | Etiqueta más ancha; sin verificador propio |

Recomendación por defecto: **EAN-13 con prefijo interno**, salvo que
SICAR use Code128 hoy — en cuyo caso conviene igualarlo para que las
etiquetas nuevas y viejas convivan sin que el personal note diferencia.

Sea cual sea, el código se genera **una sola vez** y desde ese momento se
comporta como heredado: no se regenera nunca.

## 3. El generador de variantes

Es la función central del milestone. El flujo:

1. Datos del padre: nombre, marca, categoría, descripción.
2. Costo y precio base, que heredan todas las variantes y luego se pueden
   ajustar individualmente.
3. Elegir colores.
4. Elegir tallas con casillas, de la escala que la categoría ya sugirió.
5. El sistema arma la matriz: 2 colores × 8 tallas = 16 variantes.
6. **La matriz se muestra y se puede editar antes de guardar.** No todo
   color viene en todas las tallas: se destildan celdas sueltas y se
   ajustan costos o precios por renglón.
7. Guardar genera códigos, crea los renglones de inventario en cero y
   deja las etiquetas listas para imprimir.

Dos requisitos que se olvidan y luego duelen:

- **Agregar tallas después.** A los seis meses llega la 29 del mismo
  modelo. Debe poder agregarse al producto existente sin tocar ni
  recrear las variantes que ya existen y ya tienen historial.
- **Ninguna variante se borra si ya tuvo movimiento.** Se desactiva. El
  historial manda.

## 4. Carga masiva

Plantilla propia de Vaquero Hub en CSV o XLSX. El requisito duro:

**Valida todo antes de escribir nada.** Primero corre en seco y devuelve
un reporte; sólo si el usuario lo acepta, escribe — y escribe dentro de
una transacción, todo o nada.

El reporte detecta, como mínimo: códigos duplicados dentro del archivo,
códigos que ya existen en el sistema, códigos vacíos, ceros iniciales
perdidos, espacios accidentales, categorías o marcas inexistentes, precios
o costos no numéricos, y tallas que no pertenecen a la escala de la
categoría.

> Este validador comparte núcleo con el sincronizador de SICAR (M9). Es el
> mismo problema —leer datos sucios de una hoja de cálculo y decidir qué
> hacer con ellos— aplicado en dos momentos distintos. Conviene escribirlo
> una vez y reutilizarlo.

## 5. Acciones en lote

Selección múltiple en el listado de variantes, para: activar y desactivar,
imprimir etiquetas, y **cambiar precios**.

El cambio de precio en lote es la acción peligrosa del milestone:

- Exige el permiso `products.price_update`.
- Muestra **vista previa de qué va a cambiar y a cuánto** antes de
  aplicar.
- Cada variante afectada genera su propio registro en `audit_log` con
  valor anterior y nuevo. Un cambio a 300 variantes son 300 renglones de
  bitácora, no uno.

Sin ese detalle, el reporte de la sección 51.4 del contexto maestro no
puede responder «¿quién bajó el precio de esto y cuándo?».

## 6. Etiquetas

- Plantillas guardadas como registros editables, no fijas en el código:
  qué campos aparecen (nombre corto, talla, color, precio, código, logo) y
  su acomodo.
- Impresión masiva desde una selección o desde una recepción de compra
  (esto último se conecta en M6).
- **Las etiquetas se imprimen desde una computadora de trastienda, no
  desde el iPad.** El iPad imprime tickets; el etiquetado ocurre al
  recibir mercancía, no en la caja. Esto simplifica mucho el problema de
  impresión discutido para M4.

## 7. Búsqueda

La cajera no busca como está capturado el producto. Requisitos:

- Por código escaneado: coincidencia exacta contra `barcodes.code`,
  instantánea.
- Por texto: nombre, marca, modelo, tolerante a acentos y mayúsculas.
- Por código parcial tecleado.
- Resultados agrupados por producto padre, mostrando las tallas
  disponibles con su existencia, no una lista plana de 16 renglones.
- La disponibilidad parte de todas las variantes y usa `left join` con
  `coalesce(inventory_by_location.qty, 0)`. Una sucursal nueva todavía no
  tiene renglones de inventario y aun así debe mostrar la variante en cero.

Ese último punto es la diferencia entre una búsqueda usable y una que
frustra: quien vende quiere ver «Bota Cuadra X — Negro: 25, 26, 27
disponibles», no dieciséis líneas.

### 7.1 Escaneo con la cámara

Aquí se introduce el componente de escaneo por cámara, especificado en
[`ESCANEO.md`](ESCANEO.md). En M2 su uso es consultar un producto
escaneando su código; el uso pesado llega en M3 (conteos) y M6
(recepción).

Un requisito de este milestone: **verificar que la cámara funciona dentro
de la PWA instalada**, en un iPhone y un Android reales, no sólo desde el
navegador. Es una falla conocida que aparece tarde y de la peor forma.

## 8. RLS

- Lectura del catálogo: cualquier usuario activo con `products.read`.
  El catálogo **no** se segmenta por sucursal; las existencias sí (M3).
- Alta: `products.create`. Edición: `products.update`.
- Cambio de precio: `products.price_update`, separado a propósito de
  `products.update`.
- Los costos sólo los ve quien tenga `reports.inventory` o
  `purchases.manage`. **Una cajera no tiene por qué ver el margen.**

## 9. Pruebas obligatorias

| # | Escenario | Resultado esperado |
|---|---|---|
| 1 | Generar 2 colores × 8 tallas | Exactamente 16 variantes, cada una con su código |
| 2 | Listar tallas de calzado | Orden 25, 25.5, 26… nunca alfabético |
| 3 | Alta de una bota con 8 tallas, cronometrada | Menos de un minuto |
| 4 | Dar de alta un código que ya existe | Rechazado |
| 5 | Intentar cambiar `legacy_sicar_code` ya poblado | `LEGACY_CODE_IMMUTABLE` |
| 6 | Agregar la talla 29 a un producto existente | Las variantes previas quedan intactas |
| 7 | Carga masiva con duplicados | Nada se escribe; reporte señala cuáles |
| 8 | Carga masiva válida corrida dos veces | La segunda no duplica nada |
| 9 | Cambio de precio en lote a 300 variantes | 300 renglones en `audit_log` |
| 10 | `CASHIER` intenta cambiar un precio | Rechazado |
| 11 | `CASHIER` consulta una variante | No ve el costo |
| 12 | Borrar una variante con movimientos | Rechazado; sólo se desactiva |
| 13 | Escanear cualquiera de los códigos de una variante | Encuentra la misma variante |

## 10. Criterios de aceptación

- [ ] Las 13 pruebas pasan en CI.
- [ ] La prueba cronometrada de alta se ejecuta con una persona real, no
      con un script.
- [ ] El disparador de códigos heredados está activo y probado.
- [ ] La validación de carga masiva no escribe nada en modo seco.
- [ ] La búsqueda agrupa por producto padre.

## 11. Preguntas abiertas de este milestone

1. ¿Qué simbología imprime SICAR hoy? (define la sección 2)
2. ¿Qué escala de tallas usan para sombreros y texanas?
3. ¿Y para cinturones — por centímetros, por pulgadas, o por letra?
4. ¿Manejan el mismo modelo en varios anchos, o el ancho no aplica?
5. ¿Quieren ver el margen en la pantalla de producto, o sólo el precio?
6. ¿Qué datos debe llevar la etiqueta impresa hoy en SICAR? Conviene una
   foto de una etiqueta actual.
