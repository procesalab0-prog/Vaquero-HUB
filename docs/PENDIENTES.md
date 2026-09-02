# Pendientes: quién hace qué

> Todo lo que quedó dicho en revisión y no vive en ningún otro documento.
> Está separado por **quién puede hacerlo**, porque buena parte no se
> resuelve programando.
>
> La cola de implementación vive en [`COLA_DE_TRABAJO.md`](COLA_DE_TRABAJO.md).
> Aquí está lo demás: lo que hay que correr contra la base real, lo que hace
> falta decidir, y un problema de proceso que ya costó trabajo dos veces.
>
> Última actualización: 2026-09-02.

## 1. Sólo lo puede hacer quien tiene acceso a Supabase

Desde el 2 de septiembre **producción y staging tienen el esquema aplicado**
(`ESTADO_Y_CONTINUIDAD.md`, entornos alojados). Eso cambia una cosa de fondo:
**una migración que ya corrió allá no se vuelve a ejecutar nunca.** Editar su
archivo no la revive; la única vía es una migración nueva.

Y trae una consecuencia que conviene no descubrir tarde: **que CI esté en
verde no significa que la corrección llegó a la base con los datos.** CI corre
`supabase db reset` y reconstruye desde cero, así que siempre ve el árbol
completo. Producción no.

### 1.1 Aplicar dos migraciones correctivas

| Migración | Qué arregla |
|---|---|
| `20260902150000_m2_candado_de_combinacion.sql` | Serializa la comprobación de combinaciones repetidas. Sin ella, dos altas simultáneas crean la misma talla dos veces |
| `20260902170000_m2_prefijo_interno_reservado.sql` | Impide registrar códigos de proveedor en el rango `20`–`29`, que es del generador |

Las dos usan `create or replace`, así que **son seguras se hayan aplicado o
no las versiones anteriores**: dejan el mismo estado final en cualquier caso.

Comprobado sobre una base que simula producción: entra sin candado y sin la
protección de prefijo, y sale con las dos.

### 1.2 Tres consultas de verificación

Conviene correrlas **ahora**, mientras M3 no existe y por lo tanto ninguna
variante tiene movimientos de inventario. Después, limpiar lo que aparezca ya
no será posible sin romper historial.

**Combinaciones duplicadas** — las restricciones sólo revisan lo que se
escribe de aquí en adelante; si se crearon antes, ahí siguen:

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

**Campos de la migración de SICAR escritos por error** — son inmutables una
vez puestos, y una fila envenenada tumba la migración real:

```sql
select id, sku, legacy_sicar_code from public.variants
where legacy_sicar_code is not null;
select code, source from public.barcodes where source = 'SICAR';
```

**Códigos en el rango reservado** — la migración impide los futuros, no los
que ya estén:

```sql
select code, source from public.barcodes
where symbology = 'EAN13' and code ~ '^2[0-9]' and source <> 'GENERATED';
```

Las cuatro deben devolver **cero filas**. Si alguna devuelve algo, hay que
limpiarlo antes de seguir.

### 1.3 La compuerta que sigue abierta

**No se genera un solo código de barras en producción** hasta comprobar
contra la exportación de muestra de SICAR que ningún código heredado de trece
dígitos empieza con `20`–`29` (sección 8 de
[`specs/CODIGOS_Y_SKU.md`](specs/CODIGOS_Y_SKU.md)).

Esa comprobación dejó de ser una precaución y pasó a ser **la única
mitigación**, porque la simbología quedó escrita en tres lugares del código y
los códigos ya generados son inmutables.

## 2. Decisiones que no me tocan a mí

### 2.1 ¿Quién registra el código de un proveedor?

`register_variant_barcode` exige `products.update`, que hoy sólo tienen
ADMIN y MANAGER.

Pero adoptar el código de un proveedor ocurre **al recibir mercancía**, y el
almacenista —que sí puede crear productos, y con ello acuñar códigos
generados— no puede registrar uno de proveedor. Es inconsistente con lo que
ese rol ya hace, y deja el trámite en manos de quien no tiene la caja
enfrente.

| Salida | A favor | En contra |
|---|---|---|
| Dar `products.update` al almacén | Un cambio de una línea | Demasiado amplio: también permite renombrar y recategorizar productos |
| Crear un permiso propio, p. ej. `products.barcode_register` | Ajustado a la tarea real | Una migración más y un permiso más que administrar |

**No se implementa ninguna hasta que el dueño decida.** Es una regla de
negocio, y las reglas de negocio no se inventan.

### 2.2 Las que ya estaban

Siguen en [`PREGUNTAS_CLIENTE.md`](PREGUNTAS_CLIENTE.md). La primera urgencia
es la 1.1 —qué simbología imprime SICAR hoy— porque de ella depende la
compuerta de arriba.

## 3. Un problema de proceso que ya costó trabajo

**Los PR de revisión no se están fusionando por GitHub.** El contenido se
copia a `main` a mano y el PR se queda abierto.

No es sólo desorden. Ya se perdió trabajo dos veces, y las dos en silencio:

| Qué se perdió | Cómo se recuperó |
|---|---|
| La tarea de probar la cámara y los códigos impresos | Cherry-pick, después de notar que faltaba |
| La corrección del candado de combinación | Reescrita dos veces; a esta fecha **sigue sin llegar a `main`** |

Nadie se entera cuando pasa: el PR sigue abierto y en verde, y el contenido
simplemente no está. Se detecta comparando archivo por archivo.

**Fusionar por GitHub lo resuelve por completo**, y de paso deja claro qué
PR trae trabajo pendiente y cuál ya se aplicó. Hoy hay siete abiertos —#7,
#9, #10, #11, #12, #13 y #14— y no se distingue.

## 4. El riesgo de calendario, dicho con números

Contra el alcance de octubre —ocho milestones, M0 a M5 y M9— vamos en
**~30 % del código**, ponderado por las semanas del plan:

| Estado | Milestones |
|---|---|
| Terminados | M0, M1, M1B |
| En curso | M2 (~60 %: falta carga masiva y etiquetas) |
| Sin empezar, con especificación escrita | M3, M4, M5 |
| Bloqueado | M9, esperando la exportación de muestra |

Faltan entre seis y siete semanas de trabajo según el propio plan, y quedan
seis hasta mediados de octubre. **Sale, pero sin holgura y sólo con dos
personas programando en paralelo.**

Y ahí está lo que hay que resolver hoy y no en tres semanas:
[`REPARTO_TRABAJO.md`](REPARTO_TRABAJO.md) sigue marcado **⛔ EN ESPERA — NO
ARRANCAR**, porque así se pidió. Mientras la segunda cuenta no arranque, el
plan de seis semanas corre a una sola vía y no cuadra.

Hay además un detalle que no aparece en el porcentaje: once pantallas existen
en la interfaz, pero **sólo tres están conectadas a la base** —productos,
clientes y administración—. Caja, POS, inventario, tickets, etiquetas y
ajustes son cascarones (issue #4).

## 5. Lo que sigue programando

Está en [`COLA_DE_TRABAJO.md`](COLA_DE_TRABAJO.md), de arriba hacia abajo.
Lo inmediato:

1. **Tarea 0**, suelta y sin bloquear: probar la cámara dentro de la PWA
   instalada y, con ella, que un código generado e impreso **de verdad se
   lea**. Hoy nada lo comprueba: las diez pruebas del generador son
   aritméticas. Y el escaneo con cámara no es un extra — SICAR ya lo tiene y
   el personal lo usa.
2. **Edición de producto y variante**, lo último que falta de M2.2.
3. **M2.4 carga masiva** y **M2.5 etiquetas**, para cerrar M2.
4. **M3 inventario**, que es el de mayor riesgo técnico del proyecto.

## 6. La pregunta que conviene llevar encima

Cinco hallazgos de este proyecto fueron del mismo tipo: **algo que parecía
proteger y no protegía.**

Un `revoke` que rompía consultas en vez de negarlas. Un contador revertido
por la excepción que lo seguía. Una función que confiaba en el id que le
pasaban. Un control que existía pero no llegaba a la base con los datos. Un
candado escrito en un archivo que ya no vuelve a ejecutarse.

Los dos últimos son los más incómodos, porque **CI estaba en verde en los
dos casos.**

Así que la pregunta no es sólo si el control existe: **¿este control de
verdad hace lo que dice, y lo hace donde importa?**
