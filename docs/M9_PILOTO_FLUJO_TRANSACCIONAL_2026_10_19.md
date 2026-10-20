# M9 · Ensayo transaccional de los doce códigos del piloto

## Especificación previa

Alcance autorizado: continuar en staging, sin tocar producción. El ensayo amplía
el libro técnico anterior con las funciones existentes de lector, venta, ticket,
caja y devolución. No aprueba saldos SICAR, reservas cero ni apertura comercial.
No se cambia esquema, interfaz, permisos, precios, costos o código de barras.

El generador exige las mismas observaciones fijadas por SHA256, identidades,
auditoría y captura reciente del ensayo del libro. Sólo genera una transacción
que termina en ROLLBACK. Mantiene la guarda habilitada; una revisión exclusiva
del lote permite temporalmente sólo los códigos del ensayo. Los demás siguen
bloqueados. No requiere ni elimina libros vacíos: conserva las ventas previas.

Por código se verifican lector literal, una venta en efectivo, repetición sin
duplicado, rechazo de reintento modificado y sobreventa, ticket y costo NULL.
Una devolución sin autorización debe fallar. Para probar el motor de devolución
se usa un token sintético de mantenimiento, confinado a la transacción, como en
los ensayos SQL existentes. Esto no comprueba PIN real, Auth/PostgREST, lector
físico ni interfaz y no se presenta como autorización humana.

Se retira la revisión antes de devolver: recibir el artículo vendido sigue
siendo posible, entregar otro requiere revisión vigente. Se comprueban reembolso
por el mismo método, consumo único del token, repetición sin duplicar, inventario
restituido y efecto neto cero en caja. Después del rollback se comparan huellas
de las tablas auditadas, incluyendo la guarda, autorizaciones y folios.

No se inicia ningún pedido Woo, correo o cobro externo. Las secuencias técnicas
pueden avanzar con rollback; no se reinician. Un cambio concurrente de la captura
obliga a recapturar y regenerar, sin suprimir controles. La aceptación operativa
desde Preview y el corte de compromisos de SICAR siguen siendo pasos separados.

## Ejecución y evidencia

PASS real en zsezjtswqeijboezvado: cuatro transacciones de tres códigos,
doce ventas y doce devoluciones sintéticas, doce lecturas literales y tickets,
140 comprobaciones del flujo. Se cobraron/reembolsaron 1,525,900 centavos de
prueba; efecto neto cero en caja. Cada venta/reembolso se repitió sin duplicar.
Se rechazaron doce sobreventas, doce reintentos de venta modificados, doce
devoluciones sin autorización, doce cambios con revisión retirada y doce
reutilizaciones del token consumido. La devolución IN funcionó después de
retirar la revisión de venta; el cambio OUT quedó bloqueado.

La revisión temporal permaneció habilitada y sólo admitió los tres códigos de
cada tanda. Todos los demás quedaron fuera, incluidos los otros nueve códigos
del piloto. La preparación de stock reutilizó la validación completa de los
doce códigos, observaciones originales y auditoría; no modifica ese generador
anterior para convertirlo en un activador.

Las 120 tablas de public/app se compararon por conteo y huella completa después
de cada rollback: idénticas a la captura inicial. Incluye productos, Clave 1,
inventario, caja, ventas, devoluciones, créditos, apartados, lealtad, borradores,
colas web, control de revisión, autorizaciones y folios. Permanecen dos ventas,
una devolución y ocho movimientos históricos. No quedaron tickets nuevos,
autorizaciones sintéticas, activación ni mercancía de ensayo. No se reiniciaron
secuencias para disimular huecos técnicos.

Se conservan dos intentos iniciales: el primero señaló
RETURN_PAYMENT_TOTAL_MISMATCH porque el ensayo del libro había adelantado las
restricciones diferibles antes de la operación financiera siguiente. Se restituye
su evaluación diferida normal y se fuerza la comprobación completa al final;
no se elimina ni deshabilita ninguna restricción o trigger. El segundo perdió
la respuesta del conector; no se cuenta como PASS. No había consulta pendiente,
y ambas auditorías de 120 tablas permanecieron iguales. Para obtener respuestas
verificables, la ejecución final se dividió en cuatro tandas acotadas.

PASS local: 861 unitarias/106 archivos, incluidas 28 nuevas, ESLint dirigido,
TypeScript y git diff --check. No se afirma una nueva prueba nativa local de
PostgreSQL ni otra aceptación de navegador/Auth/PIN. Este bloque son herramientas
y ensayos SQL; no hay interfaz ni nuevo despliegue web que aceptar.

## Reproducción

```text
node scripts/m9/pilot-transactional-rehearsal.mjs CONFIG_FIJADA.json SALIDA_NUEVA
```

La configuración exige review, snapshot y observations: ruta y SHA256 de cada
archivo. Preparación sin red ni cliente SQL, cuatro tandas como máximo de tres
códigos, plan y manifiesto. No sobreescribe una salida existente. Valida todas
las entradas antes de crear archivos. Dos corridas finales son idénticas; sus
cuatro SQL coinciden byte por byte con los ejecutados. La captura vence a la
hora: para otro ensayo se recaptura, audita y regenera; no se edita la fecha.

Evidencia privada: outputs/m9-piloto-flujo-transaccional-2026-10-19/ contiene
captura con 120 huellas, definiciones vivas consultadas, cuatro SQL/resultados,
auditoría posterior de cada tanda, intentos previos, dos corridas, pruebas y
reporte.html. No se publican detalles financieros de clientes de SICAR.

## Arranque por etapas

1. Ensayo SQL del lote: completado; no significa aceptación operativa.
2. Corte de SICAR: determinar mercancía física, vendida pendiente de entrega y
   compromiso financiero, con evidencia del mismo alcance. No volver a descontar
   una venta ya reflejada en el libro ni convertir una consulta parcial en cero
   reservas. Mantener sin definir los compromisos no identificados.
3. Preparar plan de saldos/compromisos con referencias y reversión para el
   almacén Default → La Piedad ya confirmado, revalidando el catálogo renovado.
4. Cargar sólo el lote aprobado de prueba y aceptar desde Preview con Auth real:
   lector → venta → ticket → devolución/PIN → caja, y conciliar al finalizar.
5. Ampliar por lotes confirmados. Productos dudosos siguen pendientes; el corte
   y autorización productiva son separados y todavía no se ejecutan.

Cobertura de catálogo sin cambio: 15,876/16,381 = 96.92% en staging. No es un
porcentaje de ventas reales habilitadas ni de migración productiva terminada.
