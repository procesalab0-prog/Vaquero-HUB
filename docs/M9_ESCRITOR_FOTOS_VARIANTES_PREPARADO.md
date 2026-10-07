# M9 — Escritor condicional de fotos propias por talla

7 de octubre de 2026. Continúa el [lector remoto comprobado](M9_LECTOR_REMOTO_VARIANTES_VERIFICADO.md). Se implementó y ensayó el escritor, pero **no está instalado ni activado** en el Woo independiente de pruebas. El plugin vigente sigue 1.3.3 y no carga este módulo. No se anuncia sincronización publicada por talla como terminada.

## Lo que queda implementado

`scripts/m9/woo-remote/variant-photo-write.php` acepta exclusivamente las dos familias ya revisadas, cinco variantes exactas por familia. Fija en servidor los códigos literales y SHA256 originales de las nueve fotos candidatas; no acepta escoger otro archivo por nombre. La talla 2XL/código10324 debe conservar imagen propia vacía. El resto reutiliza adjuntos existentes, sin subir archivos ni editar alt, galería, padre, precios, atributos, códigos o existencias.

El paquete exige revisión completa de fotos y galería. Compara identidades con la lectura autenticada del recibo de familia; no basta el código solo. Rechaza adjuntos duplicados, imagen propia distinta, paquete parcial, campos extra de stock/aprobación y huellas o textos alternativos cambiados. El planificador puro `variant-photo-packet.mjs` usa la preparación de bytes original y el contexto remoto, recibidos del servidor; nunca deben recibirse del formulario del navegador. Construir el paquete no concede autorización ni lo despacha.

Reserva un recibo persistente por identificador antes de modificar metadatos. Exige tablas InnoDB, abre transacción y bloquea padre, hijos, adjuntos, metadatos y recibo; vuelve a comprobar la evidencia dentro de los bloqueos. Sólo puede asignar `_thumbnail_id` de una variante que está vacía. Comprueba la lectura posterior completa antes del COMMIT. Ante error previo al COMMIT revierte las asignaciones; un resultado incierto conserva su recibo y nunca repite automáticamente las fotos. La consulta del recibo puede reconciliar su estado contra la evidencia anterior almacenada sin volver a asignar imágenes. Esta conciliación escribe únicamente el estado del recibo; no debe describirse como una consulta SQL totalmente libre de escrituras.

No constituye una transacción distribuida con Supabase. Los bloqueos de base no bloquean una sustitución externa de archivos en disco; por eso se comprueban hashes en lecturas consecutivas y antes/después. La cola y la acción publicada deberán conservar la misma condición y enviar sólo después de una preparación fresca.

## Verificación

- 25 pruebas unitarias nuevas del paquete; suite completa **541 pruebas / 70 archivos** aprobada. Lint y formato dirigidos aprobados. No cambió TypeScript ni la interfaz del programa en este bloque.
- **42 controles PHP** en runtime8.3 aislado, con fixtures explícitos de WordPress y transacciones. Incluyen repetición, cambio concurrente, propietario del recibo, intento de llenar10324, sobrescritura, error parcial, error de persistencia, COMMIT con respuesta perdida, COMMIT no aplicado y recuperación sin nueva escritura de foto. No equivalen a una prueba del escritor instalado en Woo real.
- Dos preparaciones autenticadas de sólo lectura contra el Woo de pruebas produjeron **tres archivos JSON idénticos** por corrida: dos paquetes y resumen. Se cotejaron recibos/identidades, bytes originales locales/remotos y lecturas antes/después. **2familias / 10variantes / 9candidatas / 1ausencia**, cero asignaciones remotas. No es una exportación comercial nueva de SICAR/Woo.
- Staging conserva7,709filas gestionadas,8,515pendientes,0respuestas de dueños y cero saldos/movimientos. Huella de catálogo d3fe299f72f3b8ab6d9f869ee9ddf4bf. Cobertura47.516% sin aumento.

## Continuación concreta

Falta integrar la cola persistente y la acción de ficha, conectar el cliente al nuevo protocolo, preparar el paquete de actualización del plugin vigente y verificar el escritor instalado con las dos familias autorizadas. Sólo entonces ensayar las nueve asignaciones, repetición y recuperación remotas. No ampliar automáticamente a las5,815fotos ni activar el módulo directamente por incluirlo en un ZIP. Siguen separados los adjuntos independientes y las referencias ambiguas del diagnóstico general.

Las preguntas con opción múltiple ya funcionan en Preview, de tres en tres. El usuario confirmó que **la integración a main será al terminar esta parte**, preservando las mejoras de otros chats. No se cambia main ahora ni se fusiona toda la rama de staging. [Detalle de las tandas](M9_PREGUNTAS_POR_TANDAS.md). Captura renovada sin responder por los dueños.

Evidencia en `outputs/m9-escritor-fotos-variantes-2026-10-07/` del workspace principal: script reproducible de sólo lectura, corrida-1/2, comparación, controles PHP, conservación de staging y captura de opciones. Comando del ensayo: `node scripts/m9/woo-remote/test-variant-photo-write.mjs ../m9-woo-runtime`. El runtime y la credencial privada deben existir; no se empaquetan ni se imprimen secretos.

Cero modificaciones en Woo de pruebas o producción, cero escrituras Supabase, sin existencias/pedidos/pagos, sin despliegue ni merge. Preview permanece0.78.0. Sol suficiente para este bloque; Astra para inventario operativo, pedidos/devoluciones y auditoría final.


Actualización 7 de octubre: preparación seguida de instalación y ensayo real completado para las dos familias; estado actual en [M9_COLA_FOTOS_VARIANTES.md](M9_COLA_FOTOS_VARIANTES.md). No extender la afirmación a otras familias.
