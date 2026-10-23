# Plan: identidades literales y revisión documental de entregas

Base: cierre `a7c26e2`. Trabajo aislado, sin cambios remotos ni producción.

1. Fijar por SHA el archivo de 60 cuentas/84 documentos, el SICAR normalizado completo y la consulta exacta de staging. Conciliar únicamente Clave 1 literal. Los nombres no deciden vínculos. Un código genérico de deuda nunca representa una pieza física.
2. Separar código inexistente, duplicado, no cargado y variante inequívoca. No crear IDs. Conservar las fuentes y sus fechas; esta preparación no convierte el archivo en un corte operativo.
3. Preparar una pregunta por documento que cubra expresamente sus líneas: todo entregado, todo pendiente, mixto o no confirmado. El saldo o los abonos no prueban entrega. Para documentos mixtos se requiere cobertura completa, cantidades exactas y evidencia; una línea genérica conserva cantidades físicas desconocidas.
4. Implementar un diario privado y aditivo de observaciones documentales, anclado al archivo inmutable. Los eventos y su anulación se añaden; no se actualiza el archivo original. Idempotencia y versión esperada impiden aplicar una respuesta sobre una revisión que cambió.
5. Ensayar localmente con datos sintéticos, autorización administrativa y RLS denegada. Comparar todas las tablas antes/después de ROLLBACK. Probar versiones obsoletas, archivo alterado, códigos normalizados, respuesta parcial, fecha imposible y controles en códigos.

Todos los planes y observaciones son inertes: no abren deudas, caja, clientes nativos, reservas, descuentos de stock ni entregas. El JSON privado no autentica a quien lo redactó. Una futura operación requiere revisión y autorización independientes, corte vigente y conciliación física, incluso si se registró una observación documental.

El coordinador es el único escritor de staging. SQL de este bloque es borrador fuera de `supabase/migrations`.

## Resultado del bloque

Se conciliaron las 17 líneas sin variante contra las 16,396 filas del catálogo SICAR renovado el 22 de octubre y la consulta exacta de staging del mismo día a las 23:29 UTC. Quince son deuda genérica: conservan cantidad física desconocida. Dos códigos existen una sola vez en SICAR completo y todavía no figuraban en esa captura de staging. El preparador provisional existente del coordinador admite uno y retiene otro por `CATEGORY_CONFLICT`. No se fuerza categoría ni se agrupan por descripción. La consulta se identifica como anterior a cualquier alta posterior del coordinador.

El módulo prepara 84 paquetes privados para 183 líneas de 60 cuentas, con respuesta inicial `UNKNOWN`. Son paquetes listos para una futura revisión por documento; no se publicaron 84 preguntas. Los hashes completos de catálogo, archivo de créditos, captura y plan provisional están fijados en el manifiesto privado. La exportación de catálogo nueva no renueva el corte de créditos.

El diario SQL es privado, de mantenimiento, con RLS denegada y autorización ADMIN/`customers.manage` en staging. Compara el documento completo contra el archivo inmutable y su hash JSONB calculado por PostgreSQL, sin confiar en un hash JS como si fuera SQL. Registra revisiones y anulaciones aditivas con idempotencia por solicitud y actor. No concede acceso público ni modifica líneas registradas, saldos, inventario o caja. Los lectores operativos existentes no consumen estas observaciones.

`UNKNOWN` físico no constituye un bloqueo global artificial de una apertura puramente financiera: esa elegibilidad se evalúa por separado con saldo, titular, corte, autorización y doble apertura. Este diario no cambia esa elegibilidad en ninguna dirección.

Validación: 48 pruebas unitarias; ESLint y formato correctos. En la base local aislada `qa_m9_entregas_block3_20261022`, el ensayo sintético cubrió 27 rechazos adversariales y 9 de permisos, replay y anulación. Durante el ensayo sólo cambió el nuevo diario: las otras 166 tablas permanecieron idénticas. Tras ROLLBACK, las 167 tablas quedaron idénticas. Auth y Storage locales son stubs; no equivale a aceptación con sesión real.

Reproducción: `node scripts/m9/clientes-lines-delivery.mjs <config-privada> <salida-privada>`; se rechaza cualquier entrada cuyo SHA cambie. Dos corridas con iguales entradas producen bytes idénticos. Ensayo local: `QA_DATABASE_URL=<sólo DB aislada autorizada> node scripts/m9/clientes-delivery-journal-test.mjs <reporte-privado>`. El ejecutor rechaza cualquier host remoto u otra base de datos.

Artefactos privados: `outputs/m9-clientes-lineas-entregas-2026-10-22/`, fuera de Git y con permisos 700/600. Incluyen evidencias de ambos cortes de catálogo, consultas, configuración con hashes, dos corridas finales, plantillas vacías no confirmadas, reporte local y manifiesto verificado. Este bloque no ejecutó DDL/DML remoto ni vinculó líneas; el coordinador deberá revisar cualquier vínculo posterior al alta literal.
