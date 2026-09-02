# Generación de SKU y códigos de barras

> Especificación transversal: la generación vive en M2, la colisión con
> datos heredados vive en M9, y la impresión en las etiquetas de M2.5.
>
> Fecha: 2026-09-02. Revisado contra la implementación el mismo día.

## 1. Por qué esto merece su propia especificación

Un código generado se pega en una caja, se escanea en una caja registradora
y se queda ahí durante años. **No se puede deshacer.** Si el formato sale
mal, no se corrige: se arrastra, exactamente igual que los códigos
heredados de SICAR que por regla nunca se tocan.

Además, hoy hay un hueco: `create_catalog_product` **exige** que quien
llama mande el código de barras. Eso obliga a la interfaz a inventarlo, y
es justo de donde salen los duplicados y los formatos inconsistentes. La
especificación de M2 dice que el sistema lo genera; todavía no lo hace.

## 2. Un solo número interno del que salen los dos

**Decisión central:** existe **una sola secuencia** interna, y de ella se
derivan el SKU y el código de barras.

```
serial interno:  1002347
SKU:             1002347-4      ← serial + dígito verificador
código de barras: 2010023474…   ← prefijo + serial + dígito de la simbología
```

La alternativa —un contador para el SKU y otro para el código— parece
inocente y trae un problema real: los dos números se desincronizan, y
cuando alguien reporta «el código 20100234749 está mal», nadie puede decir
de un vistazo a qué SKU corresponde.

Con una sola secuencia, **quien mira un código de barras reconoce el SKU
adentro**, que es lo que hace posible diagnosticar un problema en el piso
de venta sin abrir la base de datos.

```sql
create sequence app.variant_serial_seq
  as bigint start with 1000000 minvalue 1000000 maxvalue 999999999 no cycle;
```

Vive en el esquema privado `app` —no en `public`— para que la interfaz no
pueda reservar números por su cuenta. Sólo la llama el generador, que es
`security definer`.

Los huecos son aceptables: si un alta falla después de tomar el número, ese
número se pierde. Mismo criterio que los folios de venta — un hueco en la
numeración es preferible a un número repetido.

## 3. El SKU

- **Formato:** el serial más un dígito verificador de Luhn, como el número
  de socio de M1B. Reutilizar `app.member_check_digit` o extraerla a una
  función común; **no escribir una segunda implementación de Luhn.**
- **Por qué lleva verificador:** alguien va a teclear un SKU a mano.
  Sin dígito verificador, un error de dedo puede caer en **otro artículo
  existente** y la operación se hace sobre el producto equivocado, en
  silencio. Con verificador, la mayoría de los errores rebotan.
- **Es inmutable.** Es la identidad del artículo. Se genera una vez.
- **No lleva información codificada.** Nada de `CUA-BOT-26-NEG`.

Sobre esto último, que es una tentación fuerte: un SKU «parlante» se ve
más útil y envejece mal. Codifica la marca, la categoría y la talla — y
todas esas cosas cambian. Un producto se recategoriza, una marca se
renombra, y el SKU queda mintiendo para siempre porque es inmutable. La
información legible ya viaja al lado: la búsqueda devuelve nombre, marca,
talla y color, y la etiqueta los imprime.

## 4. El código de barras

### 4.1 Simbología

**Decisión pendiente** (pregunta 1.1 de `PREGUNTAS_CLIENTE.md`): depende
de qué imprime SICAR hoy. Pero la estructura de este documento funciona
con cualquiera de las dos, así que **no bloquea el trabajo**: se
implementa detrás de una constante de configuración.

| Opción | A favor | En contra |
|---|---|---|
| **EAN-13 con prefijo interno** | Lo lee cualquier lector, incluso un láser barato. Dígito verificador incluido en el estándar. Cabe en plantillas de etiqueta estándar | Sólo numérico, largo fijo |
| **Code128** | Alfanumérico, largo libre | Etiqueta más ancha; sin verificador propio |

**Recomendación por defecto: EAN-13 con prefijo interno.** GS1 reserva los
prefijos `20`–`29` para circulación restringida dentro de una empresa, así
que un código nuestro **nunca puede chocar con el de un fabricante**. Esa
garantía es la razón de elegirlo, no la estética.

Estructura propuesta: `20` + serial de 10 dígitos con ceros a la izquierda
+ dígito verificador EAN-13 = 13 dígitos.

Si resulta que SICAR imprime Code128, conviene igualarlo para que las
etiquetas nuevas y las viejas convivan sin que el personal note diferencia.

### 4.2 Se genera dentro de la misma transacción

El código se toma de la secuencia **dentro** de `create_catalog_product`,
no antes ni desde la interfaz. Si el alta falla, no queda un código
suelto asignado a nada.

### 4.3 La simbología quedó fija en el código, no detrás de una constante

Hay que decirlo con precisión porque cambia qué protege qué. La
implementación emite EAN-13 con prefijo `20`, y ese formato está escrito en
**tres lugares**: el generador dentro de `create_catalog_product`, la
función `app.is_valid_generated_barcode`, y la restricción
`barcodes_generated_identity_check` que la usa.

No es un defecto —EAN-13 es la recomendación de arriba y el formato correcto
mientras nadie diga lo contrario—, pero sí cambia el cálculo: si la
respuesta a la pregunta 1.1 llega y dice Code128, no es cambiar una
constante, son tres cambios coordinados **y los códigos ya generados se
quedan en EAN-13 para siempre**, porque son inmutables.

Consecuencia práctica: **la compuerta de la sección 8 dejó de ser una
precaución y pasó a ser la única mitigación.** Ningún código se genera en
producción antes de esa comprobación.

## 5. Una identidad por artículo no basta: hace falta una por combinación

Este es el hueco que abrió el propio generador, y conviene entender por qué
apareció justo al mejorar las cosas.

Antes, quien llamaba mandaba el código de barras. Si el alta traía dos
renglones con la misma talla y el mismo color, el segundo chocaba contra la
unicidad de `barcodes.code` y el alta entera se caía. **Esa protección era
accidental**: no había ninguna regla sobre combinaciones repetidas, sólo
sobre códigos repetidos.

Al generar ahora una identidad nueva para cada renglón, los dos duplicados
reciben SKU y código distintos, y el alta pasa sin ruido.

El resultado es peor que un error visible: el mismo artículo físico queda
con dos identidades, la existencia se parte entre las dos y un escaneo cae
en una o en otra según qué etiqueta se pegó en la caja. **El inventario por
talla —la razón de ser del proyecto— deja de cuadrar sin que nadie lo
note**, y se descubre meses después contando físicamente.

La regla:

- **Dentro de un producto, no puede haber dos variantes con el mismo
  conjunto de atributos.** Sin excepciones por estado: cuenta también una
  variante dada de baja, porque el artículo físico es el mismo.
- Un producto **sí** puede tener una variante sin atributos —una hebilla,
  un accesorio sin variaciones—, pero **una sola**.
- Si la variante existía y se dio de baja, se **reactiva**; no se crea otra.
  La vieja carga el historial.

Y una advertencia sobre dónde vive el control: **la deduplicación de la
interfaz no cuenta.** La carga masiva de M2.4 y el importador de M9 entran
por la misma función sin pasar por la pantalla. El control vive en la base.

Está resuelto con restricciones diferidas —se comprueban al cerrar la
transacción, no renglón por renglón— porque durante el alta una variante
pasa por estados intermedios, ya creada y todavía sin todos sus atributos,
que un control inmediato leería como duplicados falsos. El efecto secundario
de diferirlas es que el error sale **fuera** del `exception` de
`create_catalog_product`: llega como `DUPLICATE_VARIANT_ATTRIBUTES` y no
traducido a `CATALOG_DUPLICATE_VALUE`. Quien escriba una pantalla nueva
tiene que atender ese nombre.

## 6. Cuándo NO se genera: el código del proveedor

Muchas botas llegan con el código del fabricante ya impreso en la caja.
Usarlo evita reetiquetar, que es trabajo real.

**Pero hay una trampa específica del calzado, y hay que verificarla caja
por caja antes de confiar en ella:** varios fabricantes imprimen **el mismo
código para todas las tallas de un modelo**. Si se adopta ese código, en la
caja registradora no se puede distinguir una del 26 de una del 28, y el
inventario por talla —que es la razón de ser de este proyecto— deja de
funcionar.

Regla:

- **Se usa el código del proveedor sólo si es distinto para cada talla.**
  Se registra con `source = 'SUPPLIER'`.
- **Si el proveedor repite el código entre tallas, se genera uno propio**
  y se reetiqueta.
- La comprobación es trivial y hay que hacerla al recibir: escanear dos
  tallas distintas del mismo modelo y ver si dan lo mismo.

Esto conecta con la recepción de mercancía de M6 y con el etiquetado
masivo de M2.5.

## 7. Un código generado no se edita: se agrega otro

Si un código quedó mal impreso o hay que reemitirlo, **no se modifica la
fila**. Se agrega un código nuevo a la variante y se marca como primario;
el anterior sigue existiendo y sigue escaneando.

El motivo es físico: si ese código ya está pegado en cuarenta cajas,
cambiarlo en la base deja cuarenta etiquetas huérfanas. Manteniendo ambos,
las cajas viejas siguen funcionando y las nuevas salen con el código
nuevo.

**El esquema ya lo permite** — `barcodes` admite varios por variante, con
un único primario — así que esto no requiere cambios, sólo respetarlo.

## 8. Colisión con los datos heredados: verificación previa

Riesgo concreto: un código que generemos hoy podría coincidir con uno que
la migración de SICAR traiga mañana. Ahí no habría salida limpia, porque
los códigos heredados son inmutables.

El prefijo `20` lo hace improbable, pero **improbable no es comprobado**.

**Compuerta antes de encender la generación en producción:** correr sobre
la exportación de muestra de SICAR

```
¿existe algún código de 13 dígitos que empiece con 20-29?
```

Si la respuesta es cero, la generación es segura. Si no lo es, hay que
elegir otro prefijo o cambiar de simbología **antes** de generar el primer
código, no después.

Esta comprobación es parte del ensayo 1 del runbook y depende de conseguir
la exportación de muestra — que es la primera urgencia de
`PREGUNTAS_CLIENTE.md`.

### 8.1 Regla para el importador de M9

**El importador no inventa SKU: los toma de `app.variant_serial_seq`, igual
que el alta manual.** El SKU es identidad nuestra; el código de SICAR viaja
aparte, en `legacy_sicar_code`, y ése sí se conserva tal cual.

El motivo es concreto y silencioso. `service_role` puede escribir en
`variants` directamente, y la restricción de formato sólo exige que el SKU
sea un número con verificador válido — no que venga de la secuencia. Un
importador que numere por su cuenta desde, digamos, `2000000` deja la
colisión programada: el día que la secuencia llegue ahí, el alta de un
producto nuevo se cae con violación de unicidad, meses después, sin relación
aparente con la migración que lo causó.

Aplica lo mismo a cualquier guion de respaldo o de reparación que cree
variantes desde el servidor.

## 9. Qué queda bloqueado y qué no

| Parte | Estado |
|---|---|
| La secuencia, el SKU y su verificador | **Construido** en `20260902023531` |
| Generación dentro del alta de producto | **Construido**; el alta rechaza identidades del cliente |
| Unicidad de la combinación de atributos | **Construido** en `20260902041500` (sección 5) |
| Elección de simbología | EAN-13 con prefijo `20`, fija en tres lugares (sección 4.3) |
| Encender la generación en producción | **Espera la comprobación de la sección 8** |
| Registrar un código de proveedor | Sin función que lo permita todavía (sección 6) |
| Reemitir un código | El esquema lo permite; falta la función (sección 7) |

En corto: **el generador ya está**. Lo que falta es la luz verde de que no
choca con SICAR, y las dos funciones que dan de alta códigos que no salen
del generador.

## 10. Pruebas obligatorias

| # | Escenario | Resultado esperado |
|---|---|---|
| 1 | Alta de una bota con 8 tallas sin mandar códigos | 8 SKU y 8 códigos, todos distintos |
| 2 | Dos altas simultáneas | Sin seriales repetidos |
| 3 | Un SKU con un dígito mal tecleado | Rechazado por el verificador; **no encuentra otro artículo** |
| 4 | Código generado | Cumple la simbología elegida y su dígito de control |
| 5 | Alta que falla a media transacción | No queda ningún código asignado |
| 6 | Reemitir un código | Se agrega uno nuevo; el anterior sigue escaneando |
| 7 | Intentar cambiar el SKU de una variante | Rechazado |
| 8 | Código de proveedor repetido entre dos tallas | Rechazado al registrarlo |
| 9 | Dos renglones con la misma talla y el mismo color | Rechazado; el producto entero se revierte |
| 10 | Un producto con una sola variante sin atributos | Aceptado; con dos, rechazado |

La prueba 3 es la que justifica el dígito verificador y conviene que
exista aunque parezca redundante. Las pruebas 9 y 10 cubren el hueco que
abrió el generador (sección 5) y son las que se rompen primero si alguien
cambia el alta sin leer esa sección.

**Las diez son aritméticas.** Comprueban que el código está bien formado y
que su dígito de control cuadra, todo dentro de la base de datos. **Ninguna
comprueba que un código impreso se lea con un aparato**, y ese margen de
error es cero: el código es inmutable y termina pegado en cajas, así que un
ancho de barra o un contraste mal elegidos ya no se corrigen, se
reetiquetan.

Esa comprobación física vive en la sección 8 de
[`ESCANEO.md`](ESCANEO.md) —generar, imprimir, escanear y confirmar que
devuelve los mismos trece dígitos— y no depende de nada bloqueado: se puede
correr hoy.

## 11. Preguntas abiertas

1. ¿Qué simbología imprime SICAR hoy? (pregunta 1.1)
2. ¿Qué impresora de etiquetas usan, y qué anchos admite? Define si un
   EAN-13 cabe cómodo. (pregunta 1.8)
3. ¿Quieren que el SKU aparezca impreso en la etiqueta además del código
   de barras? Ayuda a buscar a mano cuando el código no escanea.
4. ¿Hoy reetiquetan todo lo que llega, o aprovechan el código del
   fabricante cuando existe?
