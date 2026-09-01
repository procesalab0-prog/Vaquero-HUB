# RUNBOOK — Corte de SICAR y conexión de WooCommerce

> Procedimiento operativo del cambio de sistema. Se escribe con meses de
> anticipación y se ejecuta al final, tal cual está aquí.
> Complementa a [`PLAN_CODEX.md`](PLAN_CODEX.md) sección 7.
>
> Última actualización: 2026-08-31.

## 0. La idea central

**"Que cuadre a la primera" no se logra la noche del corte. Se logra
ensayando el mismo procedimiento tres veces antes, con datos reales.**

La noche del corte debe ser aburrida: un procedimiento que ya se corrió
varias veces, con tiempos medidos y sin sorpresas. Si la primera vez que
el importador ve datos reales es esa noche, no va a cuadrar.

Por eso este documento tiene dos mitades: los **ensayos** (secciones 2 a
4), que es donde realmente se resuelve el problema, y la **noche del
corte** (sección 6), que sólo ejecuta lo ya probado.

## 1. Qué se migra (la lista que se olvida)

Migrar existencias es lo obvio y lo fácil. Lo que rompe una tienda al día
siguiente son los **compromisos abiertos**:

| Dato | Por qué importa si se olvida |
|---|---|
| Existencias por variante y ubicación | Base de todo |
| Costos por variante | Sin esto la valuación de inventario nace rota |
| **Apartados abiertos, con saldo y mercancía apartada** | Esa mercancía está físicamente separada; si aparece disponible, se vende dos veces |
| **Saldos de crédito de clientes** | Si se pierden, se regala dinero o se cobra de más |
| Compras pedidas y no recibidas | Llega mercancía que el sistema no espera |
| Notas de crédito / saldos a favor pendientes | El cliente llega a usarlas y no existen |
| Clientes (datos, teléfono, cumpleaños) | Base de lealtad y crédito |
| Códigos heredados: `legacy_sicar_code` y filas en `barcodes` con `source = 'SICAR'` | Sin esto no hay forma de emparejar con WooCommerce después |

Antes del ensayo 2 hay que confirmar con el cliente **qué de esto usa
realmente** — puede que no lleven crédito, o que no tengan compras
pendientes. Lo que no se use, no se migra.

## 2. Decisión previa: migrar fiel, no migrar corregido

En cualquier tienda real el inventario físico no coincide exactamente con
el del sistema: hay merma, escaneos equivocados y años de deriva
acumulada. Si SICAR dice 3 y en el anaquel hay 2, migrar fielmente
significa **copiar también ese error**.

Hay dos filosofías y **no deben mezclarse**:

1. **Migrar fiel** — copiar SICAR exactamente, errores incluidos.
2. **Migrar y corregir** — hacer conteo físico completo y arrancar limpio.

**Decisión recomendada: migrar fiel.** Un conteo físico de ~15,000 filas
toma días con la tienda cerrada y no es realista. Además, migrar fiel hace
que la validación de esa noche sea una pregunta binaria y sin ambigüedad:
*¿Mi Tienda SM dice exactamente lo mismo que SICAR? Sí o no.*

La corrección del inventario físico se hace **después**, con conteos
cíclicos por categoría usando el módulo de conteos de Mi Tienda SM, ya con
la tienda operando normal.

Mezclar los dos problemas es lo que lleva a estar a las 2 de la mañana sin
saber si una diferencia es un error del importador o una bota que alguien
se robó hace ocho meses.

## 2.5 Estrategia: carga progresiva del catálogo, refresco final de existencias

**Ésta es la decisión que hace manejable todo el corte.** No se migra todo
la misma noche: se separan los datos según qué tan rápido cambian.

| Tipo de dato | Qué tan volátil | Cuándo se carga |
|---|---|---|
| Catálogo: productos, variantes, códigos, tallas, colores, marcas, categorías, costos, precios | Cambia lento | **Semanas o meses antes**, y se vuelve a sincronizar periódicamente |
| Proveedores y clientes | Cambia lento | Igual que el catálogo |
| **Existencias** | Cambia con cada venta | **Sólo al final**, con la tienda cerrada |
| **Apartados abiertos, saldos de crédito, compras pendientes** | Cambia a diario | **Sólo al final**, junto con las existencias |

La consecuencia es grande: la noche del cambio ya no se migra un catálogo
de 15,000 filas, sino que se refrescan existencias y compromisos sobre un
catálogo que lleva semanas cargado, revisado y corregido. Eso pasa de
horas a minutos, y el margen de sorpresa se reduce muchísimo.

También permite algo valioso: **el emparejamiento con WooCommerce se puede
hacer con semanas de anticipación**, en modo sólo lectura, en cuanto el
catálogo está cargado. Así los conflictos aparecen con tiempo de sobra en
lugar de la noche del cambio.

### 2.5.1 Lo que esto exige de la herramienta

El importador deja de ser un script de una sola vez y pasa a ser un
**sincronizador re-ejecutable con dos modos**:

- **Modo catálogo:** agrega lo nuevo, actualiza lo que cambió, no duplica
  nada y no toca existencias. Se corre cada semana o quincena.
- **Modo existencias y compromisos:** ajusta las existencias al valor real
  de SICAR y carga apartados, créditos y compras pendientes. Se corre **al
  inicio de cada día de prueba paralela** y una última vez la noche del
  cambio (ver 2.5.2).

Correr el sincronizador dos veces seguidas debe dejar exactamente el mismo
resultado. Si duplica productos o inventa movimientos de inventario, está
mal hecho.

### 2.5.2 El límite que no se debe cruzar

**El refresco de existencias sólo es seguro mientras Mi Tienda SM no sea
todavía el sistema de registro.** Una vez que la tienda opera de verdad
con Mi Tienda SM, sobrescribir existencias desde SICAR destruiría el
historial real de movimientos.

Esto tiene una implicación en la prueba paralela: el inventario que se
genere durante el piloto **va a ser sobrescrito** por el refresco final.
El piloto sirve para validar el proceso y comparar números, no para
construir historial permanente. Conviene decírselo al personal para que
nadie se frustre viendo que "se borró" su trabajo.

Mientras Mi Tienda SM no sea el sistema de registro, conviene aprovechar
esa libertad: **correr el refresco de existencias al inicio de cada día de
prueba paralela.** Si la jornada empieza con ambos sistemas cuadrados
exactamente, cualquier diferencia al cierre del turno es una diferencia
real —un error de captura o un defecto del sistema— y no ruido arrastrado
de pruebas anteriores. Sin eso, la comparación de fin de turno pierde
valor rápidamente.

Tiene además un efecto secundario muy conveniente: para cuando llegue la
noche del cambio, ese refresco se habrá corrido diez o quince veces y
habrá dejado de ser un procedimiento nuevo. Los ensayos de las secciones 3
a 5 salen prácticamente gratis del propio plan de pruebas.

### 2.5.3 Decisión pendiente: dónde se capturan los productos nuevos

Durante los meses de transición va a llegar mercancía nueva. Hay que
decidir, y no dejarlo al criterio del momento:

- **Opción A:** se sigue capturando en SICAR hasta el cambio, y el
  sincronizador la trae. Más lento para el personal, pero sin
  divergencia.
- **Opción B:** se captura en Mi Tienda SM aprovechando que el alta es más
  rápida, y esos productos no existen en SICAR. Entonces el sincronizador
  debe **respetarlos y nunca borrarlos**, y esa mercancía no se puede
  vender en SICAR.

Lo peligroso es el punto medio: capturar en ambos lados sin regla clara.
Ahí es donde nacen los códigos duplicados.

### 2.5.4 Vale la pena preguntar

Si SICAR permite acceso directo a su base de datos o exportaciones
programadas, la sincronización periódica se puede automatizar en lugar de
depender de que alguien exporte un Excel a mano cada semana. Conviene
averiguarlo con el proveedor o con quien administre el servidor: cambiaría
bastante el esfuerzo de toda esta etapa.

## 3. Ensayo 1 — ¿Entendemos los datos? *(antes de construir el catálogo)*

No se importa nada. Sólo se lee una exportación real y se produce un
informe:

- Filas totales, códigos únicos, productos padre estimados.
- Códigos duplicados, códigos vacíos, códigos con espacios o ceros
  iniciales.
- **Cómo codifica SICAR las variantes**: ¿la talla es una columna?
  ¿va en el nombre? ¿cada talla es una fila independiente? ¿existe algún
  código de producto padre o hay que deducirlo?
- Categorías, marcas y proveedores existentes.
- Cuántos productos tienen precio o costo en cero.

**Entregable:** un documento de mapeo columna de SICAR → campo de Mi Tienda
SM, y la lista de limpieza que el cliente trabaja en SICAR durante las
semanas siguientes. De este ensayo depende el diseño del catálogo
(milestone M2), por eso conviene correrlo desde la semana 2.

## 4. Ensayo 2 — ¿Importa limpio? *(con el importador de M9)*

Importación completa de una exportación real **en staging**. El entregable
no es "importó bien": es el **reporte de reconciliación**, que debe
generarse automáticamente en cada corrida:

- Filas leídas / importadas / rechazadas, con el motivo de cada rechazo.
- Productos padre creados y variantes creadas.
- **Suma total de existencias en SICAR vs. en Mi Tienda SM** — tiene que
  cuadrar exacto.
- Valor del inventario a costo: SICAR vs. Mi Tienda SM.
- Códigos duplicados y vacíos, y qué se hizo con cada uno.
- Lista de excepciones que requieren decisión humana.

La primera corrida va a arrojar cientos de excepciones. **Ése es el
propósito.** Cada una se resuelve de una de dos formas: se limpia el dato
en SICAR (lo hace el cliente, con calma, durante semanas), o se ajusta una
regla del importador.

Se repite el ensayo hasta que el reporte salga con cero rechazos y cero
excepciones sin explicación. Ese es el criterio para pasar al ensayo 3.

## 5. Ensayo 3 — Ensayo general cronometrado *(D-7)*

Se ejecuta el procedimiento completo de la sección 6, con el personal de
la tienda presente, **midiendo tiempos**:

- ¿Cuánto tarda la exportación desde SICAR?
- ¿Cuánto tarda la importación?
- ¿Cuánto tarda la validación automática y el muestreo físico?

Si el total son tres horas, hay que empezar justo al cerrar. Si son
cuarenta minutos, hay holgura. Sin este dato no se puede planear la noche
real.

Al terminar el ensayo, el resultado se descarta: staging se restaura y la
tienda sigue operando en SICAR con normalidad.

## 6. La noche del corte

### 6.1 Cuándo

- La noche del **día más flojo de la semana**, al cerrar, con el día
  siguiente completo como colchón.
- **Evitar:** quincena, fines de semana, temporada alta (diciembre,
  regreso a clases, fiestas locales, día de las madres).
- **Nunca** un día antes de que el responsable técnico se vaya de viaje.

### 6.2 Criterio de aceptación, decidido y firmado ANTES de esa noche

Esto se define por escrito con anticipación, para que nadie improvise a
medianoche:

- [ ] Diferencia en la suma de existencias por sucursal: **cero**.
- [ ] Códigos duplicados: **cero**. Códigos vacíos: **cero**.
- [ ] Muestreo de 40 códigos (alta rotación + alto valor + azar):
      **100 % coincide** con SICAR.
- [ ] Apartados abiertos: cantidad y saldo total **cuadran exacto**.
- [ ] Saldos de crédito: total **cuadra exacto**.
- [ ] Conteo físico de una sección completa (ej. una pared de botas):
      cuadra contra Mi Tienda SM.

**Si cualquiera falla: se hace rollback y se reprograma. Sin heroísmos.**
La tentación de "ya casi, lo parcho y seguimos" a las 2 de la mañana es
exactamente lo que convierte un corte en un desastre de dos semanas.

### 6.3 Secuencia

**D-7**
1. Ensayo general (sección 5).
2. **Última sincronización de catálogo** en modo catálogo (sección 2.5).
   A partir de aquí el catálogo ya no debería moverse.
3. Congelar altas masivas de catálogo en SICAR hasta el cambio.

**D-1**
4. Confirmar que no queden apartados, compras ni devoluciones sin
   capturar en SICAR.
5. Verificar respaldos y accesos.

**Día D, al cerrar la tienda**
6. Corte final de caja en SICAR. **A partir de aquí SICAR no recibe ni un
   movimiento más.**
7. Exportación final de existencias y compromisos abiertos.
8. Respaldo de la base de Mi Tienda SM → **punto de retorno**.
9. Sincronizador en **modo existencias y compromisos** contra producción.
   El catálogo ya está cargado desde hace semanas: aquí sólo se ajustan
   existencias, apartados, créditos y compras pendientes.
10. Reporte de reconciliación automático.
11. Validación contra el criterio de la sección 6.2, incluido el muestreo
    físico. **Lo verifica el personal de la tienda, no sólo el
    desarrollador.**
12. Decisión explícita go / no-go, dicha en voz alta y anotada.
13. Si es go: se habilita el POS y se hace **una venta de prueba real**
    de principio a fin — escaneo, cobro mixto, ticket, cajón, y su
    cancelación.

**Día D+1 — apertura**
14. La tienda abre operando con Mi Tienda SM.
15. **SICAR queda en sólo consulta.** No se vuelve a capturar nada ahí.
16. **Se apaga el modo existencias del sincronizador.** A partir de aquí
    Mi Tienda SM es el sistema de registro y nada vuelve a sobrescribir su
    inventario (sección 2.5.2).
17. Presencia técnica en piso todo el día. No remota.

**D+1 a D+7**
18. Comparación diaria del corte de caja contra lo esperado.
19. Conteos cíclicos por categoría para empezar a corregir la deriva
    heredada (sección 2).

### 6.4 Rollback

Durante todo el proceso **SICAR sólo se lee, nunca se escribe**. Si la
validación falla, se restaura el respaldo del paso 7 y la tienda abre al
día siguiente con SICAR como si nada hubiera pasado. Se pierde una noche,
no un negocio.

**No cancelar la licencia de SICAR el día después.** Mantenerla al menos
un mes en modo consulta.

## 7. Probar "junto con ellos": son dos cosas distintas

### 7.1 Prueba de operación — semanas antes del corte

Con la foto de datos en staging, el personal usa Mi Tienda SM en paralelo
con SICAR durante varios turnos (la prueba paralela de la sección 7 del
contexto maestro). Al cierre de cada turno se comparan ventas, productos,
cantidades, efectivo, tarjetas, devoluciones y cortes.

Aquí es donde aparecen los problemas **humanos**, que son los que de
verdad hacen sentir fallido un corte aunque los datos estén perfectos:

- La cajera no encuentra un producto porque busca por un nombre distinto
  al capturado.
- Las etiquetas viejas no escanean bien con el lector nuevo.
- El ticket no trae algo que el cliente siempre pide.
- Un paso que en SICAR eran dos toques y aquí son cinco.

Estos hallazgos son más valiosos que cualquier prueba automatizada, y
sólo aparecen con el personal real usando el sistema con clientes reales.

### 7.2 Validación del corte — esa noche

Aquí el personal no prueba el sistema: **verifica los números**. Conteo
físico de una sección y muestreo de códigos contra SICAR. Es un rol
distinto y conviene decírselos así.

## 8. WooCommerce, después del corte

WooCommerce no requiere cerrar la tienda, pero sí requiere que el catálogo
real ya esté en Mi Tienda SM. Se hace en el mismo fin de semana del corte o
en los días inmediatos: **mientras más se tarde, más se desactualiza el
stock publicado en línea.**

### 8.1 Antes de conectar

- **Despachar todos los pedidos en línea pendientes.** Un pedido pagado y
  no surtido ya consumió existencia en WooCommerce pero no ha salido
  físicamente. Arrancar con esa ventana abierta genera diferencias
  imposibles de explicar. Se cierra la ventana: se surte todo y se arranca
  desde cero pendientes.

### 8.2 Fase de sólo lectura

Se leen todos los productos y variaciones de WooCommerce y se emparejan
**por código, nunca por nombre**. El entregable es un reporte de cuatro
grupos:

1. **Existe en ambos y el código coincide** → listo para vincular.
2. **Sólo en WooCommerce** → ¿se da de alta en Mi Tienda SM o se despublica?
3. **Sólo en Mi Tienda SM** → ¿se publica o se queda sólo en tienda física?
4. **Mismo código pero difiere precio, nombre o existencia** → lista de
   conflictos a resolver uno por uno.

**No se escribe nada en WooCommerce hasta que el cliente revise ese
reporte.** El grupo 4 es el que trae las sorpresas.

### 8.3 Encendido

1. Primer empuje de existencias en horario de bajo tráfico (madrugada),
   por lotes o categorías, no todo de golpe.
2. Verificar en la tienda en línea que las existencias publicadas
   coinciden.
3. Encender los webhooks de pedidos entrantes.
4. Prueba de punta a punta: una compra real en línea, de bajo monto, hecha
   por alguien del equipo → verificar que descuenta inventario **una sola
   vez**.
5. Reenviar manualmente el mismo webhook para confirmar que el sistema lo
   ignora por duplicado.

### 8.4 Primera semana

Comparación diaria entre existencias de Mi Tienda SM y de WooCommerce, con
alerta ante cualquier divergencia. Es la ventana donde aparecen los
problemas de idempotencia y de pedidos concurrentes entre el POS y la web.
