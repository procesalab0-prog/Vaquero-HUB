# M9 — actualizaciones condicionadas en el laboratorio

Versión preparada 0.65.0. No habilita producción ni importa existencias.

El worker conserva la revisión previa de todos los recursos y, al actualizar, envía también el snapshot esperado a `POST /m9-local/v1/conditional-update`. La ruta adquiere un bloqueo exclusivo persistido mediante una inserción SQL exclusiva sobre la clave única de opciones (sin upsert), vuelve a leer el recurso y compara la respuesta REST completa antes de delegar el PUT al controlador WooCommerce. La comparación incluye enlaces REST: se usa `response_to_data`, no solamente `get_data`.

Un cambio detectado devuelve409; un bloqueo ocupado devuelve423. El worker registra REVIEW_REQUIRED y no reintenta automáticamente ni recurre a PUT normal. Una caída que deje el bloqueo exige inspección manual: no hay expiración ni apropiación automática. Los errores de respuesta siguen tratándose como resultado incierto; conciliación por ID conocido continúa siendo de sólo lectura.

Restricciones del servidor:
- Sólo entorno local y URL exacta `http://127.0.0.1:9417`; copia recuperada de sólo lectura excluida.
- Usuario con permiso de gestionar Woo, más permisos del controlador Woo interno.
- Padre borrador marcado como ensayo; identidad y snapshot explícitos.
- Campos de actualización limitados a nombre, textos, precio regular, imágenes/categorías y marcador de operación. No se admiten existencias, promociones, publicación ni cambios de Clave1/identidad.
- PUT/PATCH/DELETE y POST de actualización directos en rutas de catálogo wc/v3, incluido batch, bloqueados fuera de la delegación interna. Las creaciones de padres/variantes se conservan para el laboratorio.

## Alcance y límites

El bloqueo serializa esta ruta de actualización. No es una transacción distribuida por familia: un padre puede actualizarse y un hijo quedar en revisión. Tampoco incorpora un contador de versión que detecte ABA, ni intercepta WP-admin, CLI, otros plugins, otras versiones REST o las creaciones permitidas. Esos escritores deben permanecer fuera del ensayo supervisado. No instalar este guard en la tienda real.

La copia real MariaDB probada antes y el laboratorio actual son distintos: este último usa WordPress Playground7.0.6, WooCommerce11.1.2 y un worker PHP. Dos solicitudes simultáneas con el mismo snapshot produjeron una aceptación y un conflicto, pero no se declara prueba de múltiples procesos PHP concurrentes en esta instancia.

## Evidencia del 5 de octubre

`outputs/m9-adaptador-protegido-2026-10-05` (fuera del repositorio):
- Worker SUCCEEDED con actualización protegida sobre familia sintética23/hijo24.
- Edición inyectada después del preflight y antes del envío: REVIEW_REQUIRED, edición conservada.
- Repetición del job conflictivo: cero solicitudes.
- Dos solicitudes con mismo snapshot: una acepta, otra rechaza.
- PUT directo409; inventario400; cambio de código400; batch409; sin autenticación401.
- Valores originales de la familia restaurados, salvo fechas de modificación. Diarios separados; no se alteraron los diarios originales del laboratorio.
- 181 pruebas unitarias aprobadas. Primera ejecución global se lanzó desde directorio incorrecto y falló sólo la prueba Python de recuperación por ruta; repetición desde raíz del repo pasó completa.

El primer ensayo HTTP detectó discrepancia de enlaces en el snapshot y falló sin actualizar el catálogo; se corrigió y se conservó su diario. El servidor de laboratorio arrancado incorpora el guard nuevo. No se realizaron despliegues Vercel ni escrituras en Woo/Supabase de producción.

Antes de producción: validar el canal integrado en el destino de prueba correspondiente, resolver coordinación de escritores y recuperación por familia, obtener corte y respaldo frescos y aprobación comercial/autorización de publicación. El avatar del Preview publicado sigue en0.64.0: versión0.65.0 preparada localmente, pendiente de despliegue y comprobación visual del avatar. Staging no está cerrado.

Corrección previa a publicar: se sustituyó add_option porque su SQL usa ON DUPLICATE KEY UPDATE. El bloqueo usa INSERT ordinario y sólo libera la fila si conserva el token propio; no vence ni sobrescribe un bloqueo existente.
