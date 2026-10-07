# M9 — Cola de fotos propias por talla

Estado al 7 de octubre de 2026: migración SQL instalada sólo en staging; conector remoto 1.3.4 instalado en la tienda independiente de pruebas. La comprobación real desde la ficha está pendiente. No confundir controles aislados con un envío verificado.

## Alcance

Únicamente las dos familias previamente ensayadas (solicitudes 97c82026-b3cc-4c60-8f22-13d7c00fb33a y ba239bba-7691-43cc-9c76-8768a1af9f21). Nueve fotos propias candidatas y una ausencia deliberada (10324). Conserva los códigos SICAR, precios, UUIDs y galerías. No carga existencias ni modifica pedidos, pagos o la tienda real.

## Operación y recuperación

La ficha ofrece «Comprobar y enviar fotos por talla» sólo cuando el conector remoto confirma la capacidad. El servidor verifica permisos, evidencia y copias de staging; registra una solicitud durable antes del único POST. Una solicitud existente se consulta por recibo, sin reenviar. Los cambios concurrentes de catálogo, imágenes o precios requieren revisión. No se vencen solicitudes ni se inventan nuevos identificadores para reintentar.

La tabla privada tiene RLS sin políticas y ninguna concesión directa; las funciones sólo están disponibles al servicio y validan al empleado. Los comprobantes enlazan propietario, paquete, foto y lectura posterior. El escritor remoto bloquea filas y usa una transacción InnoDB; los archivos se verifican por hash antes y después, sin prometer una transacción distribuida.

## Validación

554 pruebas unitarias en 71 archivos, 32 controles SQL con reversión, 42 controles aislados del escritor y 16 del plugin completo. Compilación, tipos y lint correctos. Los ensayos SQL no dejan catálogo, existencias ni solicitudes de prueba.

Paquetes reproducibles 1.3.4 (dos corridas idénticas): SHA256 0fdf612583755e42675b32af9e73ccea8f98c802f41edb0b3a7de12b2b82f02b. Evidencia local: outputs/m9-cola-fotos-variantes-2026-10-07/.

Cobertura operativa previa: 7,709 de 16,224 filas SICAR (47.516%). Este bloque de conexión no aumenta esa cifra. Las preguntas permanecen en tandas pequeñas y su integración a main se hará al cerrar esta parte, preservando las mejoras de otros chats.
