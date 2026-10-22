# M9 · Última pieza POS/Woo · Plan antes del ensayo

Sólo base PostgreSQL local nueva qa_m9_woo_race_20261022 en 127.0.0.1:59432.
No reutilizar ni vaciar una base existente; no restaurar datos de clientes.
Reconstruir todas las migraciones, habilitando control STAGING sólo en esa base
vacía. Datos sintéticos: administradores, dos cajas, códigos QA, precios de ensayo,
costo NULL y una pieza explícitamente ficticia. Nunca usar credenciales remotas.

Usar conexiones PostgreSQL reales con distintos backend PID. Iniciar el ganador,
ejecutar su operación y mantener COMMIT pendiente; lanzar el competidor. Observar
pg_blocking_pids desde una tercera conexión antes de confirmar el ganador.
Después el competidor debe releer stock/reservas vigentes y rechazar la segunda
salida. Probar ambos órdenes: reserva Woo primero y venta POS primero; después
liquidar la reserva ganadora mediante la venta financiera nativa y cancelarla
con prueba sintética separada de reembolso/recepción física. No usar CONSUME
seguido de create_sale ni RESTOCK seguido de cancel_sale.

Probar además POST financiero vs POS, dos POST idénticos, dos cancelaciones
idénticas, rollback del primer comprador y órdenes de líneas opuestos. Los
reintentos deben conservar recibo/venta; stock nunca negativo ni doble descuento.
Assertar solapamiento, ganadores/rechazos, movimientos exactos, pagos únicos,
costos NULL y caja sin efectivo. Conservar historia sintética sólo en esa base QA;
compensar cada venta/reserva al cerrar y deshabilitar controles. No borrar auditoría.

Comparar definiciones críticas reconstruidas contra staging por SHA256: motor
nativo, núcleo Woo y servicio financiero. Esto es aceptación SQL local del motor,
no checkout público/pasarela/entrega real, Auth/PostgREST ni certificación de red.
Si no se observa bloqueo, el escenario falla y no se anuncia como aprobado.
Conservar SQL, hashes, backend PID, espera/bloqueos y resultados reproducibles.

La primera reconstrucción en una base nueva de la instancia local compartida
se detuvo en pg_cron: cron.database_name sólo permitía postgres. No se cambió esa
configuración compartida ni se omitió la migración. Usar contenedor dedicado
m9-woo-race-20261022 con imagen local17.6.1.165 y cron.database_name apuntado a
la base QA. La base incompleta anterior queda sin utilizar, sin datos de tienda.

## Resultado del 22 de octubre de 2026

PASS: ocho escenarios con dos procesos PostgreSQL distintos (PID1102/1103) y
pg_blocking_pids observado antes de liberar COMMIT/ROLLBACK. Esperas87–102ms.
1. Reserva Woo gana; venta POS rechaza INSUFFICIENT_STOCK.
2. POS gana; reserva Woo rechaza INSUFFICIENT_STOCK.
3. Venta financiera Woo gana; POS rechaza la segunda salida.
4. Dos POST financieros iguales conservan venta/recibo; segundo es replay.
5. Dos cancelaciones totales iguales conservan recibo; una reposición.
6. POS revierte; Woo puede reservar y liquidar sin consumir dos veces.
7. Woo revierte; POS puede vender la pieza.
8. Dos artículos enviados en orden opuesto: bloqueo observado sin deadlock.

Se reconstruyeron196migraciones sin editar sus fuentes. SHA256 de cinco funciones
idénticos a staging: create_sale_engine, apply_movement, m9_woo_pilot_command,
m9_woo_native_finance y cancel_sale_base. El setup local usa stubs explícitos de
Auth/Storage, no autentica usuarios reales ni certifica Auth/PostgREST.

Historia del ensayo local:8ventas/8pagos sintéticos (6Woo y2POS), todas canceladas,
9movimientosSALE y9SALE_CANCELLATION,12recibosfinancieros. Reservas0, costo conocido
artificial0, stock negativo0 y movimientos de efectivo no cero0. Se conservaron
8aperturas con importe0 de las preparaciones/ensayo; no se presentan como cobro.
Quedaban10piezas de semilla sintética (8del ensayo correcto y2de preparaciones
fallidas). Se retiraron con10ADJUSTMENT nativos: inventario y reservas final0;
sin borrar ventas,abonos,movimientos ni auditoría. Controlesfalse al cierre.

Preparación: hubo fallos locales por pg_cron, escucha TCP y preload; se resolvieron
en contenedor propio m9-woo-qa-20261022, sin cambiar configuración de los cuatro
entornos locales compartidos. No se instaló software nuevo. Primera instancia
parcial y contenedores fallidos se conservaron detenidos para diagnóstico.
Los fixtures iniciales corrigieron SKU, JSON y apertura de caja para usar sus
formatos/funciones nativas; no se relajaron aserciones de stock o bloqueo.

## Reproducir

Usar una instancia PostgreSQL local propia; puerto publicado sólo127.0.0.1,
base qa_* vacía, PostgreSQL17 y pg_cron con cron.database_name apuntado a esa base.
Cargar pg_stat_statements,pg_cron al arrancar. Instalar extensión pg_cron en esa
base con su administrador local antes del bootstrap; no modificar un servidor
compartido. QA_DATABASE_URL es una variable de entorno local, nunca URL remota.

    QA_DATABASE_URL=<local-qa-url> QA_OUTPUT_DIR=<directorio-privado> node scripts/m9/bootstrap-native-local-qa.mjs
    QA_DATABASE_URL=<local-qa-url> QA_OUTPUT_DIR=<directorio-privado> node scripts/m9/verify-woo-pos-concurrency.mjs
    QA_DATABASE_URL=<local-qa-url> QA_OUTPUT_DIR=<directorio-privado> node scripts/m9/close-native-local-qa.mjs

Bootstrap rechaza base poblada. La reanudación QA_RESUME_FROM sólo se permite con
marcador privado SYNTHETIC LOCAL QA ONLY y nombre de migración explícito; se usó
para completar pg_cron tras instalar la extensión, sin reejecutar DDL previo.
El runner requiere cero ventas al empezar, así que una repetición completa debe
usar una base QA nueva; nunca truncar ventas/auditoría para reintentar.

Cierre del motor SQL, no checkout remoto: quedan pasarela, transporte del pedido,
componentes comerciales no cero, recepción física y aceptación completa desde Woo.
No se crean pedidos Woo ni se usan ventas/existencias/clientes reales. No hubo DDL
ni escritura de datos en staging en este bloque. No main/producción.
