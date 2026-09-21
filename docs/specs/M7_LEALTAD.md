# M7 · Programa de lealtad

> Fuente de verdad para puntos y canjes. Última actualización: 2026-09-21.

## Reglas confirmadas

- El cliente puede existir y acumular sin cuenta; la cuenta de Mi Vaquero es
  opcional y sirve para consultar tarjeta, saldo e historial.
- La identidad principal sigue siendo el cliente central de Mi Tienda SM.
- Una compra regular acumula **1 punto por cada $100 pagados**.
- Un punto conserva siempre el mismo valor: **$1 MXN**.
- Mercancía con oferta o descuento acumula a la mitad: **1 punto por cada
  $200 pagados**. No se cambia el valor del punto.
- Mayoreo no acumula. La identificación explícita de la tarifa de mayoreo se
  conectará cuando el POS registre el nivel de precio aplicado; nunca se
  adivina comparando importes.
- Una venta de contado acumula al concluir. Una venta a crédito acumula sólo
  cuando su cargo queda liquidado. Un apartado acumula cuando se entrega y se
  convierte en venta liquidada.
- Los puntos vencen doce meses después de ganarse.
- No existe mínimo de canje.
- El cliente genera desde Mi Vaquero un código temporal de seis dígitos. El
  código está ligado a su cuenta, cantidad y vencimiento; usarlo no puede
  convertir puntos de otra persona.
- Cambios y devoluciones recalculan automáticamente los puntos. Si el cliente
  ya gastó los puntos retirados, queda una deuda de puntos que se cubre con
  ganancias futuras; nunca se bloquea la operación monetaria.
- Los puntos comienzan en la fecha oficial de lanzamiento. No se calculan
  retroactivamente sobre ventas de prueba ni compras anteriores.
- Niveles y beneficio de cumpleaños permanecen fuera de esta entrega hasta
  definir diferencias y porcentajes por marca o producto.

## Estructura y controles

- `loyalty_program_config`: compuerta de lanzamiento y parámetros versionados.
- `loyalty_accounts`: saldo disponible, deuda y acumulados de cada cliente.
- `loyalty_point_lots`: lotes con vencimiento individual y saldo restante.
- `loyalty_transactions`: libro inmutable de ganancias, vencimientos y
  reversos.
- `loyalty_redemption_codes`: códigos temporales; nunca se guarda el código en
  texto claro.

Las tablas no admiten escrituras directas desde clientes ni empleados. Las
operaciones pasan por funciones controladas, con RLS, permisos mínimos y
serialización por venta o cliente.

## Entrega 0.54.0

- Motor de acumulación regular y con descuento.
- Crédito acumula al liquidarse, no al entregar mercancía.
- Apartados acumulan mediante la venta final.
- Vencimiento a doce meses.
- Reverso por cancelación, cambio o devolución.
- Saldo e historial en Mi Vaquero.
- Generación de código temporal de canje.
- El programa nace desactivado hasta fijar la fecha oficial de lanzamiento.

## Siguiente bloque

- Consumir el código dentro de la misma transacción que cobra la venta y
  convertir los puntos a un descuento auditable.
- Mostrar saldo y canje en el POS y en Clientes.
- Marcar explícitamente el nivel de precio de mayoreo para excluirlo sin
  heurísticas.
- Configuración administrativa visible para fecha de lanzamiento.
