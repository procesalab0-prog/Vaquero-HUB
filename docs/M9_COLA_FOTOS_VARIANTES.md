# M9 — Cola de fotos propias por talla

Estado al 7 de octubre de 2026: migración SQL instalada sólo en staging; conector remoto 1.3.4 instalado en la tienda independiente de pruebas. Ensayo real desde las dos fichas completado en Preview 0.79.0: nueve fotos asignadas, diez variantes verificadas y ausencia 10324 conservada. Las dos repeticiones consultaron la misma solicitud con éxito; quedaron dos recibos SUCCEEDED, sin duplicados.

## Alcance

Únicamente las dos familias previamente ensayadas (solicitudes 97c82026-b3cc-4c60-8f22-13d7c00fb33a y ba239bba-7691-43cc-9c76-8768a1af9f21). Nueve fotos propias candidatas y una ausencia deliberada (10324). Conserva los códigos SICAR, precios, UUIDs y galerías. No carga existencias ni modifica pedidos, pagos o la tienda real.

## Operación y recuperación

La ficha ofrece «Comprobar y enviar fotos por talla» sólo cuando el conector remoto confirma la capacidad. El servidor verifica permisos, evidencia y copias de staging; registra una solicitud durable antes del único POST. Una solicitud existente se consulta por recibo, sin reenviar. Los cambios concurrentes de catálogo, imágenes o precios requieren revisión. No se vencen solicitudes ni se inventan nuevos identificadores para reintentar.

La tabla privada tiene RLS sin políticas y ninguna concesión directa; las funciones sólo están disponibles al servicio y validan al empleado. Los comprobantes enlazan propietario, paquete, foto y lectura posterior. El escritor remoto bloquea filas y usa una transacción InnoDB; los archivos se verifican por hash antes y después, sin prometer una transacción distribuida.

## Validación

554 pruebas unitarias en 71 archivos, 32 controles SQL con reversión, 42 controles aislados del escritor y 16 del plugin completo. Compilación, tipos y lint correctos. Los ensayos SQL no dejan catálogo, existencias ni solicitudes de prueba.

Paquetes reproducibles 1.3.4 (dos corridas idénticas): SHA256 0fdf612583755e42675b32af9e73ccea8f98c802f41edb0b3a7de12b2b82f02b. Evidencia local: outputs/m9-cola-fotos-variantes-2026-10-07/.

Cobertura operativa previa: 7,709 de 16,224 filas SICAR (47.516%). Este bloque de conexión no aumenta esa cifra. Las preguntas permanecen en tandas pequeñas y su integración a main se hará al cerrar esta parte, preservando las mejoras de otros chats.

## Cierre del ensayo remoto

Dos lecturas finales idénticas (SHA256 03e17c8357e93a9520c481bf96c65f947c974f7b33d71e6ae61fd1c568ef4326). Se comparó cada captura completa con la original, admitiendo únicamente las nueve asignaciones de imagen propia y la revisión correspondiente: precios, atributos, códigos, UUIDs, recibos de alta y galerías intactos. Acceso a recibo anónimo antes/después 401, autorizado 200, fuera de piloto 403, API general Woo 403.

Solicitudes persistentes: d2df0e28-3f2f-4189-a7d6-3a998ca990b0 y 537e903b-9b42-4e9f-986b-c1ddafec62c8. Ambas SUCCEEDED. La repetición desde la interfaz no crea otra solicitud ni reenvía las fotos. Migración remota 20261007204631. Árbol funcional publicado bd8a10943ee57b5a30fc52d8ea9379d5be69cf31 comprobado contra los archivos locales; commit remoto a12b3843a899071bf0774a0d6adeeac346a2f885.

El catálogo mantiene la huella d3fe299f72f3b8ab6d9f869ee9ddf4bf, 7,709 filas administradas y cero saldos/movimientos. No equivale a terminar la migración de 16,224 filas. Las 8,515 pendientes siguen como evidencia por revisar. La ampliación del conector a más familias y las altas con foto independiente requieren sus propios planes, sin quitar las guardas actuales. Integración a main de preguntas sigue separada para conservar las mejoras ajenas.

La tabla privada aparece en el [aviso de RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy): es el cierre intencional para acceso sólo mediante funciones de servicio, sin permisos directos. Los avisos históricos de otras funciones y protección de contraseñas quedan registrados en advisors.json; no se amplió acceso por este bloque.

CI312 / run37685708426 / job113012849182 completo con éxito: formato, lint, tipos, reconstrucción de base, unitarias, integración, compilación y E2E.
