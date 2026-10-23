# Consulta de entregas por documento en Preview

Base integrada: `8e47cabc`, con diario de entregas vacío y vínculo documental aditivo ya conservado en staging. Esta pantalla es exclusivamente de lectura; no se habilita captura de respuestas ni acceso a escritores.

1. Reutilizar el archivo documental y la guarda `app.m9_legacy_actor`: staging exacto, usuario ADMIN activo y permiso `customers.manage`. Las RPC actuales paginan cuentas y no exponen el sidecar; preparar un lector paginado por documento, con implementación privada controlada y wrapper público invoker. Las tablas privadas y escritores mantienen sus permisos cerrados.
2. Mostrar una pregunta por documento con nombre de cuenta, folio, fecha y todas sus líneas juntas. Mantener UNKNOWN, deuda genérica sin cantidad física y opciones futuras sólo informativas. Saldo pagado e identidad vinculada no equivalen a entrega.
3. Separar los conteos históricos 166/17 de los vínculos documentales vigentes. No reescribir el archivo ni hacer que los lectores operativos consuman el sidecar.
4. Enlazar evidencia al documento exacto de la consulta existente, sin enlaces a archivos privados ni URLs deducidas de SICAR. Mantener búsquedas/paginación de servidor sin copiar el padrón entero al navegador.
5. Verificar permiso antes de obtener PII, paginación estable, documentos de folio repetido separados, Clave 1 literal y ninguna escritura mediante esta ruta. Ensayar DDL borrador sólo en clon local y conservar auditoría. Root es el único escritor remoto y publicador de Preview.

## Entrega del bloque

Ruta nueva `/migracion/entregas`, enlazada desde el centro de migración. Una pregunta por documento muestra cliente, folio y captura, agrupa sus líneas y presenta cuatro opciones futuras como texto informativo. Sólo la búsqueda GET y la navegación son interactivas: no hay radios, formularios de respuesta, acciones de servidor ni acceso a los escritores privados. La evidencia abre la cuenta y el documento exactos en la consulta existente. Allí también se evita presentar cantidades de deuda genérica como piezas.

El lector nuevo pagina ocho documentos, no ocho cuentas. Conserva la separación de archivo e identidad adicional del sidecar, consultando su vigencia mediante el lector privado existente, sin ensanchar su permiso. El contador UNKNOWN y el filtro de entrega sin confirmar corresponden a la fuente histórica; una observación documental no cambia ese estado físico. El enlace no habilita entrega o cobro.

SQL borrador en `scripts/m9/clientes-delivery-review-read.sql`: `app` contiene la implementación `SECURITY DEFINER` con `search_path=''` y la guarda ADMIN activo + `customers.manage` + staging antes de cualquier lectura, retorno vacío o error de entrada. El wrapper público es `SECURITY INVOKER`, sólo ejecutable por `authenticated`. No se otorga acceso a tablas privadas, servicios anónimos o escritores. El cliente de servidor utiliza la sesión del usuario, sin clave de servicio ni datos privados empaquetados en código.

Validación: 25 pruebas unitarias de página, permisos, paginación, foco de evidencia e identidad literal; lint y tipos correctos. La compilación Next/webpack pasó con la nueva ruta y CSS compuesto; la descarga inicial de fuentes públicas requirió red. No se publicaron cambios ni se probó aún Auth/PostgREST real para este nuevo lector.

Ensayo local aislado `qa_m9_revision_block4_20261022`, con Auth/Storage simulados: 10 documentos/11 líneas, páginas de 8 y 2, dos nombres/folios repetidos sin fusionarse, identidad del archivo separada del sidecar, 22 rechazos adversariales y seis ACL. Se rechazó un no ADMIN incluso teniendo `customers.manage`, un ADMIN inactivo, permiso ausente, staging deshabilitado y actor ausente. Los escritores y tablas privadas siguen inaccesibles. Las 168 tablas permanecieron idénticas durante las lecturas y después de ROLLBACK del fixture. Ninguna escritura remota de este agente.

Expediente privado: `outputs/m9-entregas-consulta-preview-2026-10-22/`, con recibo local, fuentes del bloque, manifiesto y validador offline. Root debe revisar/aplicar la migración del lector, validar todas las páginas reales y aceptar la pantalla con sesión ADMIN real en Preview antes de dar por publicada esta parte. No se habilitan respuestas en este bloque.
