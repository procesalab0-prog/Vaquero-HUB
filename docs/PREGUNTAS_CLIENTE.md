# Preguntas pendientes con Vaqueros SM

> Lista consolidada de todo lo que hace falta confirmar con el cliente,
> reunida desde las especificaciones y el runbook para no tener que
> perseguirla documento por documento.
>
> Está agrupada **por tema**, para que se pueda recorrer en una sola
> conversación, y cada pregunta indica **qué bloquea** y **para cuándo se
> necesita**.
>
> Última actualización: 2026-09-01.

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
| 1.8 | ¿Qué impresora de etiquetas usan hoy (marca y modelo)? | M2 | 🟡 |

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
| 5.1 | **Apartados: ¿plazo máximo, enganche mínimo, y qué pasa cuando vence?** | M7 | 🟡 |
| 5.2 | **Crédito a clientes: ¿ya lo operan en SICAR o sería nuevo? ¿Quién autoriza el límite? ¿Hay recargos?** | M7 | 🟡 |
| 5.3 | ¿Cuántos apartados abiertos suelen tener a la vez? Importa para el día del cambio de sistema | Migración | 🟡 |

## 6. Programa de lealtad

Ninguna de éstas frena el arranque: la tarjeta identifica al cliente desde
M1B sin necesidad de que los puntos existan. Pero todo el motor de puntos
queda detenido hasta tenerlas.

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

| # | Pregunta | Bloquea | Urgencia |
|---|---|---|---|
| 7.1 | **¿Quién redacta el aviso de privacidad y qué dice?** Guardar nombre, teléfono, cumpleaños e historial de compras es tratamiento de datos personales | M1B | 🟡 |
| 7.2 | **¿Las promociones y el descuento de cumpleaños se mandan sólo a quien dio consentimiento de marketing?** Recomendación: que sea explícito y separado del consentimiento de lealtad | M1B | 🟡 |

## 8. Migración de SICAR

| # | Pregunta | Bloquea | Urgencia |
|---|---|---|---|
| 8.1 | **Una exportación de muestra de SICAR, cuanto antes.** No es la migración: es leer un archivo para diseñar bien el catálogo. De ella depende M2 | M2, M9 | 🔴 |
| 8.2 | **¿SICAR permite acceso directo a su base de datos o exportaciones programadas?** Si sí, la sincronización semanal se automatiza en lugar de depender de que alguien exporte a mano durante meses | M9 | 🔴 |
| 8.3 | **De todo lo migrable, ¿qué usan realmente?** Apartados con saldo, crédito de clientes, compras pedidas y no recibidas, notas de crédito pendientes. Lo que no se use, no se migra | M9 | 🟡 |
| 8.4 | Durante la transición, **¿dónde se capturan los productos nuevos?** En SICAR hasta el cambio, o en Mi Tienda SM aprovechando que el alta es más rápida. Lo peligroso es el punto medio | M2, M9 | 🔴 |
| 8.5 | ¿Cuál es el día más flojo de la semana, y qué temporadas hay que evitar para el cambio? | Corte | ⚪ |

## 9. Hardware

| # | Pregunta | Bloquea | Urgencia |
|---|---|---|---|
| 9.1 | **¿Qué impresora térmica se va a comprar?** Debe ser de red y aceptar impresión por HTTP desde el navegador. Si no lo soporta, cambia la arquitectura del POS | M4 | 🔴 |
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
6. Qué impresora y qué lector se van a comprar (9.1, 9.2).
7. Lista de sucursales, cajas y empleados con su rol (10.1).
