# Preguntas pendientes con Vaqueros SM

> Lista consolidada de todo lo que hace falta confirmar con el cliente,
> reunida desde las especificaciones y el runbook para no tener que
> perseguirla documento por documento.
>
> Está agrupada **por tema**, para que se pueda recorrer en una sola
> conversación, y cada pregunta indica **qué bloquea** y **para cuándo se
> necesita**.
>
> Última actualización: 2026-09-09.

## Cómo usar esta lista

- Las marcadas **🔴 urgente** frenan trabajo en las próximas tres semanas.
- Las **🟡 pronto** se necesitan alrededor de la semana 5 a 7.
- Las **⚪ después** pueden esperar, pero conviene aprovechar la junta.
- Regla que no cambia: mientras una respuesta no llegue, **Codex no
  inventa la regla** — implementa lo que sí está definido y deja la parte
  pendiente fuera.

Cuando una respuesta llegue, se anota **aquí y en la especificación que la
usa**. Esta lista es el índice, no la fuente de verdad.

---

## 1. Catálogo y códigos

| # | Pregunta | Bloquea | Urgencia |
|---|---|---|---|
| 1.1 | **¿Qué simbología de código de barras imprime SICAR hoy?** Si es Code128 conviene igualarla para que etiquetas nuevas y viejas convivan; si no, se usa EAN-13 con prefijo interno | M2 | 🔴 |
| 1.2 | **Una foto de una etiqueta actual**, para saber qué datos lleva y qué tan legible es para la cámara | M2, escaneo | 🔴 |
| 1.3 | ¿Qué escala de tallas usan para sombreros y texanas? | M2 | 🔴 |
| 1.4 | ¿Y para cinturones — centímetros, pulgadas o letra? | M2 | 🔴 |
| 1.5 | ¿Manejan el mismo modelo en varios anchos, o el ancho no aplica? | M2 | 🔴 |
| 1.6 | ¿Quieren ver el margen en la pantalla de producto, o sólo el precio? | M2 | 🟡 |
| 1.7 | La carga masiva, ¿parte del Excel exportado de SICAR o de una plantilla propia de Mi Tienda SM? | M2 | 🟡 |
| 1.8 | ~~¿Qué impresora de etiquetas usan hoy?~~ **Contestado: SICAR EVA58, rollo de 58 mm, USB/RS232.** Ver `hardware/IMPRESORAS.md`. Falta la medida de la etiqueta troquelada | M2 | ✅ |
| 1.9 | ¿Quieren el SKU impreso en la etiqueta además del código de barras? Ayuda a buscar a mano cuando el código no escanea | M2 | 🟡 |
| 1.10 | ¿Hoy reetiquetan todo lo que llega, o aprovechan el código del fabricante cuando ya viene impreso? | M2, M6 | 🟡 |

## 2. Inventario y traspasos

| # | Pregunta | Bloquea | Urgencia |
|---|---|---|---|
| 2.1 | **¿Quién autoriza un traspaso: la sucursal que pide o la que manda?** | M3 | 🔴 |
| 2.2 | ¿Cuántos días de tolerancia antes de que una mercancía en tránsito se considere problema? | M3 | 🟡 |
| 2.3 | ¿Hacen conteos completos, o por sección o categoría? | M3 | 🟡 |
| 2.4 | ¿Los conteos se hacen con la tienda abierta o cerrada? | M3 | 🟡 |
| 2.5 | **¿Qué motivos de ajuste usan hoy en SICAR?** Conviene igualar la lista para que los reportes históricos sean comparables | M3 | 🟡 |
| 2.6 | ¿El personal usaría su propio teléfono para conteos, o el negocio pondría dispositivos? Cambia si hay que contemplar Android y de qué antigüedad | M3, escaneo | 🟡 |

## 3. Punto de venta y caja

| # | Pregunta | Bloquea | Urgencia |
|---|---|---|---|
| 3.1 | **¿Cuántos métodos de pago simultáneos permite hoy SICAR en una venta?** | M4 | 🟡 |
| 3.2 | ¿Qué datos debe llevar el ticket impreso? Conviene una foto de un ticket actual | M4 | 🟡 |
| 3.3 | **En un cambio, ¿se permite llevarse un producto de distinto precio? ¿Cómo se maneja la diferencia — efectivo, nota de crédito?** | M5 | 🟡 |
| 3.4 | El ticket de regalo, ¿oculta sólo precios unitarios o también los totales? | M8 | ⚪ |
| 3.5 | Envío de ticket por SMS, WhatsApp o correo: ¿qué proveedor prefieren, y es obligatorio en toda venta o sólo cuando el cliente lo pide? | M8 | ⚪ |

## 4. Compras

| # | Pregunta | Bloquea | Urgencia |
|---|---|---|---|
| 4.1 | **¿El costo de compra se maneja por promedio ponderado o por último costo?** Define cómo se valúa el inventario | M6 | 🟡 |

## 5. Clientes, apartados y crédito

| # | Pregunta | Bloquea | Urgencia |
|---|---|---|---|
| 5.1 | **Mayormente contestada:** reglas de apartados confirmadas el 9 de septiembre de 2026 y documentadas en [`specs/M7_APARTADOS.md`](specs/M7_APARTADOS.md). Quedan las decisiones puntuales de su sección 6 | M7 | 🟡 |
| 5.2 | **Mayormente contestada:** reglas de crédito confirmadas el 9 de septiembre de 2026 y documentadas en [`specs/M7_CREDITO.md`](specs/M7_CREDITO.md). Quedan devoluciones y migración de saldos | M7 | 🟡 |
| 5.3 | ¿Cuántos apartados abiertos suelen tener a la vez? Importa para el día del cambio de sistema | Migración | 🟡 |
| 5.4 | Sin enganche mínimo, ¿se permite confirmar un apartado con $0 abonados? | M7 | 🟡 |
| 5.5 | ¿Cuántos días antes del vencimiento comienza el aviso amarillo? | M7 | 🟡 |
| 5.6 | Si un cambio de producto o precio deja dinero abonado de más, ¿se devuelve o queda como saldo a favor? | M7 | 🟡 |
| 5.7 | ¿Qué excepciones permiten devolver abonos y quién puede autorizarlas? | M7 | 🟡 |
| 5.8 | En una devolución o cancelación de una venta a crédito, ¿primero se reduce la deuda y qué ocurre si ya fue pagada? | M7 | 🟡 |
| 5.9 | ¿Existen saldos de crédito actuales en SICAR que deban migrarse? | M7, migración | 🟡 |

## 6. Programa de lealtad

Ninguna de éstas frena el arranque: la tarjeta identifica al cliente desde
M1B sin necesidad de que los puntos existan. Pero todo el motor de puntos
queda detenido hasta tenerlas.

**Decisión del 9 de septiembre de 2026:** lealtad, puntos, niveles y beneficios
de cumpleaños se realizarán después de apartados y crédito. No bloquean el
cierre de la primera entrega de M7.

| # | Pregunta | Bloquea | Urgencia |
|---|---|---|---|
| 6.1 | **¿Cuántos puntos se ganan por peso gastado, y cuánto vale un punto al redimir?** | M7 | ⚪ |
| 6.2 | ¿Los puntos expiran? ¿En cuánto tiempo? | M7 | ⚪ |
| 6.3 | ¿Se ganan puntos en mercancía ya rebajada? | M7 | ⚪ |
| 6.4 | Si se devuelve una compra, ¿se retiran los puntos que generó? | M7 | ⚪ |
| 6.5 | **¿Qué se exige para redimir puntos?** El número de socio es copiable con una foto de la pantalla: acumular en la cuenta de otro es inofensivo, gastarlos no | M7 | ⚪ |
| 6.6 | Descuento de cumpleaños: ¿automático o lo autoriza un supervisor? ¿Monto o porcentaje? ¿Vale el día o todo el mes? | M7 | ⚪ |
| 6.7 | ¿Habrá niveles de cliente o un solo esquema para todos? | M7 | ⚪ |
| 6.8 | ¿Ya existe hoy una tarjeta física con código impreso, o se estrena desde cero? | M1B | 🟡 |

## 7. Datos personales

Decisiones confirmadas el 9 de septiembre de 2026:

- El cliente se dará de alta por sí mismo desde la aplicación o la web.
- El primer canal para recordatorios será WhatsApp, inicialmente mediante un
  enlace o acción iniciada por la persona, sin contratar un proveedor. La
  automatización por API se evaluará aparte porque no se debe asumir que es
  gratuita.
- Los avisos de vencimiento se enviarán con siete días de anticipación.
- ProcesaLab preparará el aviso de privacidad y lo enviará a Vaqueros SM para
  revisión y aprobación antes de publicarlo.
- El alta de una cuenta no se interpretará como consentimiento de marketing.
  Sigue pendiente confirmar si las promociones usarán una casilla opcional y
  separada; los avisos operativos y las promociones conservarán finalidades
  distintas.

| # | Pregunta | Bloquea | Urgencia |
|---|---|---|---|
| 7.1 | **Parcialmente contestada:** ProcesaLab redactará y enviará el aviso; falta aprobar el texto definitivo antes de publicarlo | M1B | 🟡 |
| 7.2 | **¿Las promociones y el descuento de cumpleaños se mandan sólo a quien dio consentimiento de marketing?** Recomendación: que sea explícito y separado del consentimiento de lealtad | M1B | 🟡 |

## 8. Migración de SICAR

| # | Pregunta | Bloquea | Urgencia |
|---|---|---|---|
| 8.1 | **Una exportación de muestra de SICAR, cuanto antes.** Recibida y analizada el 4 de septiembre de 2026; falta la comprobación física de `clave1` contra una etiqueta | M2, M9 | 🟢 |
| 8.2 | **¿SICAR permite acceso directo a su base de datos o exportaciones programadas?** Si sí, la sincronización semanal se automatiza en lugar de depender de que alguien exporte a mano durante meses | M9 | 🔴 |
| 8.3 | **De todo lo migrable, ¿qué usan realmente?** Apartados con saldo, crédito de clientes, compras pedidas y no recibidas, notas de crédito pendientes. Lo que no se use, no se migra | M9 | 🟡 |
| 8.4 | Durante la transición, **¿dónde se capturan los productos nuevos?** En SICAR hasta el cambio, o en Mi Tienda SM aprovechando que el alta es más rápida. Lo peligroso es el punto medio | M2, M9 | 🔴 |
| 8.5 | ¿Cuál es el día más flojo de la semana, y qué temporadas hay que evitar para el cambio? | Corte | ⚪ |

## 9. Hardware

| # | Pregunta | Bloquea | Urgencia |
|---|---|---|---|
| 9.1 | ~~¿Qué impresora térmica se va a comprar?~~ **Contestado: ninguna.** Se usa la BIXOLON que ya está en el mostrador, por controlador del sistema operativo. Ver `PLAN_CODEX.md` §9.1 | M4 | ✅ |
| 9.2 | **El lector Bluetooth tiene que ser imager 2D, no láser lineal**, si la tarjeta de lealtad va a vivir en el teléfono. ¿Ya se compró alguno? | M1B, M4 | 🔴 |
| 9.3 | ¿El cajón de dinero se conectará a la impresora? Es lo normal, pero define el modelo | M4 | 🟡 |
| 9.4 | ¿Cuántas cajas por sucursal y cuántos iPads? | M1 | 🟡 |

## 10. Operación

| # | Pregunta | Bloquea | Urgencia |
|---|---|---|---|
| 10.1 | **Lista de sucursales, cajas y empleados con su rol.** Es lo primero que se carga | M1 | 🔴 |
| 10.2 | ¿Requieren facturación CFDI? Si sí, se integra un PAC, no se construye | Fuera de V1 | ⚪ |

---

## Resumen: lo urgente

Si sólo se alcanza a preguntar una parte, éstas son las que frenan trabajo
en las próximas tres semanas:

1. Exportación de muestra de SICAR (8.1) y si hay acceso a su base (8.2).
2. Dónde se capturan los productos nuevos durante la transición (8.4).
3. Qué simbología imprime SICAR y una foto de una etiqueta (1.1, 1.2).
4. Escalas de talla de sombreros, texanas y cinturones (1.3, 1.4, 1.5).
5. Quién autoriza un traspaso (2.1).
6. Qué lector de códigos se va a comprar (9.2). Las impresoras ya están
   confirmadas con modelo y placa: BIXOLON SRP-330II de 80 mm y SICAR EVA58
   de 58 mm. Falta la medida de la etiqueta troquelada y si el cajón está
   conectado (1.8, 9.3).
7. Lista de sucursales, cajas y empleados con su rol (10.1).
