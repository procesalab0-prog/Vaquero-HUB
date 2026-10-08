# Preguntas de migración en el programa principal

Entrega 0.55.6, 7 de octubre de 2026. Autorizada por el usuario: «ponlas en la principal».

Inicio incluye una tarjeta con pendientes y acceso a `/productos/migracion-dudas`. Sólo se libera una tanda explícita de hasta tres preguntas. Cada tarjeta reúne las tallas, ejemplos y precio público; los códigos se despliegan opcionalmente. SAME_MODEL y CORRECTION reducen pendientes; UNSURE permanece pendiente. Las respuestas requieren sesión activa y permisos products.read/products.update. El historial conserva actor, revisión, solicitud y fecha, con protección ante reintentos y respuestas concurrentes.

## Separación de datos

`app.main_m9_review_cuts`, `app.main_m9_owner_questions` y `app.main_m9_owner_answers` almacenan únicamente evidencia congelada y aclaraciones. Tablas privadas con RLS, sin acceso directo de clientes. Sólo dos RPC públicas, con autorización en base de datos, permiten consultar/responder. No se incorporan tablas, productos, existencias, colas o conexión Woo del staging a producción. El Inicio anterior permanece intacto, con una tarjeta adicional; si la consulta no está disponible, no se rompe la operación diaria.

La primera tanda reproduce las tres preguntas liberadas del corte `6194431341d80e14902bf6018c4cffedd712aea0d3af3a2cd1c9c9deec965858`: CARONINE1501 (8 códigos), CAWRRET901 (4) y CAWRNIÑO3587 (4). No se publica el banco de 303 preguntas. Su evidencia se contrastó previamente con el corte SICAR completo. La bandeja principal comprueba vigencia del corte y huella de la evidencia congelada; no dispone de SICAR en tiempo real. Cambios de fuente exigen retirar el corte, regenerar preguntas y revisar las respuestas anteriores.

## Flujo posterior

La bandeja principal es la fuente de respuestas de los dueños desde esta entrega. No duplicar respuestas manualmente en la bandeja antigua de staging. Exportar mediante `scripts/m9/export-main-owner-answers.sql`, que mantiene el formato m9-owner-answer-export-1 compatible con el preparador de revisión técnica. Registrar SHA del archivo exportado. Una respuesta no aprueba una importación: volver a contrastar el corte vigente, los códigos completos, las retenciones manuales y cualquier corrección antes de preparar un lote. CAWRNIÑO3587 conserva su retención hasta revisión humana.

`app.load_main_m9_owner_questions` y `app.release_main_m9_question_batch` son funciones sólo del operador postgres. La siguiente tanda exige cerrar la anterior; no se libera automáticamente. Para retirar un corte, el operador cambia ready=false. El corte se bloquea al guardar para evitar una retirada concurrente.

## Validación

48 pruebas unitarias existentes y 25 controles SQL en staging, dentro de transacción revertida: anonimato, permisos directos, visibilidad de liberadas/reservadas, contador, UNSURE, reintentos, revisiones, validación de correcciones, rechazo de aprobación, historial, límite de tanda, filtros y evidencia modificada. No se registran respuestas ficticias permanentes.
