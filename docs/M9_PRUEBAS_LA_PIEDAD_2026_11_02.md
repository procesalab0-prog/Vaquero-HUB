# M9 · Pruebas en La Piedad · 2 de noviembre de 2026

## Fecha y alcance solicitados

El 23 de octubre Emmanuel fijó el **2 de noviembre de 2026** para las pruebas presenciales en La Piedad, con todo funcionando. Es fecha objetivo de aceptación integral, no un estado ya alcanzado ni autorización para escribir en producción. Se mantienen staging primero, plan, ensayo reversible, auditoría, Clave 1 literal y datos desconocidos sin completar por suposición.

La preparación debe abarcar catálogo completo SICAR (con complemento Woo donde exista), inventario confirmado, clientes/créditos/apartados, caja y conexión Woo. Los productos y saldos retenidos deben poder identificarse claramente sin impedir probar los casos confirmados. Las exclusiones se informan como pendientes; no se presentan como migración completa ni se levantan por la fecha.

## Hitos objetivo

Estas ventanas organizan el trabajo; no son entregas ya confirmadas ni una ejecución automática programada.

| Ventana | Resultado que debe comprobarse |
| --- | --- |
| 23–26 octubre | Cerrar diseño y ensayo de cancelaciones Woo con caja original cerrada; preparar procedimiento de conteo/compromisos y cierre de saldos por etapas. Desarrollo paralelo, root integra cambios remotos. |
| 27–29 octubre | Ensayo completo con fuentes renovadas: altas en Mi Tienda hacia Woo de pruebas, fotos en ambos sentidos mediante vínculos exactos, pedido de prueba y un solo descuento de inventario, cancelación y recuperación sin duplicados. Integrar clientes confirmados y probar abono/recibo/caja. |
| 30 octubre | Revisión integral de preparación. Registrar qué funciona, bloqueos y datos faltantes; corregir lo crítico y repetir sólo los recorridos afectados. Comunicar cualquier riesgo de fecha desde este punto. |
| 31 octubre–1 noviembre | Renovar cortes próximos a las pruebas, conciliar cambios mientras SICAR opera y preparar carga/ensayo reversible del lote confirmado. Conservar fuentes anteriores, pendientes y plan de reversión. |
| 2 noviembre | Pruebas en La Piedad con lector y equipos reales, junto a SICAR, resultados y diferencias registrados. La sustitución operativa requiere cierre y autorización independientes. |

Si las fuentes, la comprobación física o los controles técnicos no están listos, se registra la excepción y su impacto. No se promete operación integral sólo por tener presencia de catálogo.

## Criterios de aceptación para la visita

1. **Catálogo y escaneo:** cada Clave 1 literal lleva a la variante correcta; talla, precio público, departamento y sección comprobados. SICAR sin Woo sigue presente. Duplicados/ambiguos bloqueados; no agrupar automáticamente por similitud.
2. **Venta y caja:** venta, ticket, devolución/anulación y abonos usan los motores nativos y permisos reales; no duplican movimientos. Prueba en teléfono y computadora, incluidos lector y QR de cliente cuando corresponda.
3. **Inventario:** físico, vendido guardado y separado tienen evidencia de origen y sucursal. Reserva, venta y cancelación se concilian por variante. Las 36 cantidades actuales del piloto no se convierten en cero para liberar la prueba.
4. **Clientes y saldos:** identidad, folio, saldo y abonos de origen conciliados con un corte vigente. Apertura no vuelve a cobrar pagos históricos. Entrega se acredita por separado; las 183 líneas aún sin confirmar no se interpretan como entregadas o pendientes por el saldo.
5. **Woo:** alta desde Mi Tienda y fotos verificadas en la tienda de pruebas; pedido confirmado afecta una sola vez el inventario y conserva trazabilidad. Reintentos, respuesta perdida, devolución y cancelación con caja cerrada tienen contrato explícito y prueba. Un recibo sintético no acredita pasarela real.
6. **Corte y recuperación:** reporte reproducible de entradas, aceptados, retenidos y diferencias; ensayo y rollback auditado; fuentes/UUIDs/historial preservados. Reconciliar efectos comprometidos, sin borrar historia.

## Dependencias que deben cerrarse antes del ensayo integral

- Exportación autenticada completa de Woo cuando el usuario tenga disponible Chrome; incluye estados y variantes no visibles públicamente. Su aplazamiento vigente se respeta y no se vuelve a pedir en cada bloque.
- Corte SICAR actualizado de productos y evidencia vigente de existencias/compromisos, clientes, saldos y entregas.
- Confirmación física de La Piedad: almacén Default corresponde sólo a esta tienda, ya confirmado; cantidades y mercancía comprometida todavía no confirmadas.
- Resolver SALE_SESSION_CLOSED para el flujo web mediante diseño probado, sin reabrir caja ni eliminar guards para pasar una prueba.
- Las cinco campañas conectadas existentes y compuertas Woo se conservan. Cualquier fase de ensayo adicional requiere su propio plan y límites revisados; la fecha no autoriza a resetear contadores o habilitar producción.

## Punto de partida comprobado

Preview 68ed08c3, versión 0.92.0; 1,992 unitarias, lint, tipos y build correctos. Catálogo presente 15,961/16,396 (97.35% de presencia, no global); 435 códigos retenidos. Padrón de 172 cuentas y detalle histórico de 60 cuentas conservados por separado. No se atribuye vigencia al reprocesar fuentes.

Cierre y evidencia: [M9_CONTINUACION_INTEGRAL_2026_10_23.md](M9_CONTINUACION_INTEGRAL_2026_10_23.md).
