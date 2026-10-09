# M9 — Corte completo de SICAR disponible para revisión

7 de octubre de 2026. Se cargaron en staging **8,515 registros de evidencia pendientes**. Sumados a los7,709 registros conciliados, cubren las16,224 filas del último corte recibido. Esto **no crea8,515 productos aprobados**, no resuelve identidades ni sube la cobertura operativa del47.516%. Se separa explícitamente disponibilidad para revisión de incorporación al catálogo. La fuente sigue siendo SICAR6 y Woo autenticado histórico del6deoctubre, no una exportación nueva del7.

## Carga y conservación

Dos preparaciones idénticas,35lotes de hasta250registros. Aplicación:8,515 creados; repetición completa:0creados y8,515sin cambios. Incluye5,937SICAR_ONLY y2,578otros pendientes. Cada fila conserva código literal, descripción, departamento, sección, precio1 textual, precio en centavos sólo cuando es válido, clasificación, observaciones e IDs Woo candidatos sin aprobarlos. Código000007779 conserva ceros iniciales y precio inválido6299.99944 con centavosNULL; no se redondea. Código4485/CAWRNIÑO3587T.S/$740 queda pendiente, sin aprobación inventada.

No se cortan sufijos, agrupan modelos, crean barcodes/variantes, asignan vínculos Woo ni se cargan costos/mayoreos/existencias. No se escriben las tablas de aprobaciones. Las guardas de `plan-sicar-only` y del importador permanecen intactas. No se copian campos arbitrarios de la hoja: la entrada SQL rechaza inventario, costo y campos de aprobación.

Nueva evidencia privada en app.m9_review_cuts/app.m9_pending_review. Los cortes son inmutables por código; filas cambiadas se rechazan y un corte cerrado no admite nuevos registros. La visibilidad requiere ready=true después de comprobar8515filas,7709gestionadas y ausencia de solapamientos. Sólo se lee el último corte completo; futuras filas conciliadas se omiten del pendiente por código. Cargas sólo operador postgres y guarda STAGING existente; tablas RLS cerradas, sin acceso directo de anon/authenticated/service_role.

La huella completa de catálogo antes/después permanece d3fe299f72f3b8ab6d9f869ee9ddf4bf; se conservan7,709gestionadas,1,499padres,7,710variantes/barcodes(incluye sintético),1,497fuentes y1,498borradores. Cero saldos/movimientos. Ningún cambio Woo, producción, cola de envío o permiso comercial.

## Consulta en el programa

Nueva ruta `/productos/migracion-pendientes`, enlazada desde `/productos/migracion`: búsqueda por texto y código literal/lector,20registros por página y426páginas. Cada registro indica pendiente/nohabilitado para venta. No ofrece acción de importar, publicar ni enlazar. No aparece en caja. Muestra la diferencia entre candidatos y vínculos aprobados. Página y lector SQL exigen products.read y staging; respuestas siempre PENDING_MANUAL_REVIEW/import_allowed=false/send_allowed=false. No se entrega el paquete completo al navegador.

Versión0.77.0 publicada y comprobada en Preview. Avatar, conteos16,224/7,709/8,515 y búsquedas exactas4485y000007779 verificados en navegador. Se corrigió el reinicio de controles al limpiar filtros y se volvió a publicar. No sustituye el Woo de pruebas ni completa aún asignación de fotos por talla, pedidos o sincronización de inventario.

## Verificación

19controles SQL en transacción revertida antes de aplicar: carga, repetición, rechazo de inventario/costos/aprobación/duplicados/edición/importe inválido/ID nulo/código ya gestionado/corte cerrado, anonimato, lectura autorizada, código literal yNULL, texto, paginación, filtros y privilegios; catálogo conservado.503unitarias/68archivos,lintdirigido,tipos ybuild aprobados. Reader real comprobado para4485, primera y última página. Advisor: dos tablas nuevas conRLSsinpolíticas, intencionalmente cerradas; el lector SECURITY DEFINER comprueba empleado/permiso/staging y wrapper invoker. No se conceden permisos directos ni se usa metadata de usuario para autorizar.

Migración local creada por CLI20261007181344_m9_pending_catalog_review.sql, aplicada sólo zsezjtswqeijboezvado con registro remoto20261007182126. La prueba inicial refería public.profiles inexistente; se corrigió el actor de ensayo para usar un updated_by existente. El intento fallido revirtió toda su transacción. No se afirma que las503unitarias sean pruebas de la nuevaSQL: ésta tiene los19controles remotos independientes.

Evidencia reproducible en workspace principal outputs/m9-carga-revision-completa-2026-10-07/:corrida-1/2,aplicacion.json,repeticion.json,antes.json,despues.json,consulta.json,preparar.mjs y manifiestos. Credenciales fuera de reportes/código/navegador.

## Para cerrar antes del12

El corte completo queda disponible para buscar y revisar. Para aumentar productos aprobados siguen faltando decisiones de familias SICAR_ONLY y conflictos Woo; la carga de evidencia no sustituye sus respuestas. Reutilizar la consulta consolidada de68propuestas/405filas y los expedientes completos; no repetir preguntas resueltas. Renovar SICAR/Woo antes del ensayo final. Inventario,pedidos/devoluciones y auditoría operativa requieren Astra. No garantizar producción antes del12sin esos controles.

Publicación funcional final: local1e7b5ff246f7251a91c5da2838ad47248d0e81af,remotof777c160796e25e409d126b804b00cea3ed8ff91,árbolidénticof777a0d6a0a99cfda7620f897e3e3b59f977cdc1. Actualización de rama no forzada; no se sustituyeron historiales ni se fusionó PR87. CI 309/run 37668636253 completado con éxito: formato, lint, tipos, base de datos, unitarias, integración, build y E2E. Búsqueda exacta, ceros iniciales y limpieza de filtros verificados en la página publicada.
