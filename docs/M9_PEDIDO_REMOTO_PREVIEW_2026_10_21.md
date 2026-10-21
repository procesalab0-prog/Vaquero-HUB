# M9 · Pedido remoto y Preview · 21 octubre 2026

## Plan previo

Probar el núcleo anterior contra un pedido nativo de Woo independiente, creado
administrativamente y marcado SINTÉTICO. No es checkout público, pago bancario,
venta financiera ni aprobación del inventario de origen. Mantener bloqueados
pagos, correo, webhooks, red saliente, API Woo general y compra pública.

Extender el plugin existente con un canal de ensayo autenticado, limitado a
recibos de las dos familias remotas ya existentes y al propietario de esos
recibos. Crear sólo una línea, cantidad 1–3, sin cliente/dirección ni datos de
pago; usar el código literal y precio ya comprobados en esa familia. Bloquear
cualquier pedido ajeno y las escrituras de stock automáticas de Woo para ese
pedido. Una excepción de guardado sólo vive en el callback autenticado, ligada
al UUID del ensayo y al ID del pedido; no retirar la guarda global.

Guardar solicitud y pasos antes de cada escritura. Serializar por ensayo y
conservar recibos. Un resultado incierto se recupera por GET; no reenviar una
creación con UUID distinto. Los únicos pasos de esta prueba serán crear pendiente,
pasar a procesamiento y cancelar. En este escenario sintético, cancelación
implica reposición de las piezas de prueba; no generalizarlo a pedidos reales.

Desde Preview, una cola privada registra despacho y una lectura del pedido
valida nuevamente propietario, IDs, código/precio y journal completo. El SQL
ejecuta el núcleo de reservas/consumo/reposición con stock SINTÉTICO y rollback;
sólo persisten solicitud y evidencia, sin ventas, caja, costos o stock reales.
La firma HMAC existente sigue siendo preparación: este bloque utiliza lectura
autenticada y todavía no es recepción automática de webhooks.

Preparar por separado el envío condicionado de disponibilidad, manteniendo
revisiones, resultado incierto, origen fijo y alcance de las mismas variantes.
La captura de cambios POS y carrera real entre conexiones se verifican antes
de afirmar sincronización continua. No prometer cierre con pruebas secuenciales.

## Verificación y reversión

Pruebas PHP aisladas y unitarias antes de actualizar el plugin de pruebas;
relectura de sus ocho protecciones después. Ensayo SQL con rollback y huellas de
las tablas existentes. Publicar sólo la rama Preview y comprobar con sesión real.
Los pedidos sintéticos se conservan cancelados para auditoría; no borrarlos.
El rollback local deja los conteos SICAR en NULL y el control privado apagado.
Regresión de catálogo/fotos y permisos; ni main ni producción reciben cambios.

Pendientes separados: checkout público de prueba, documentos financieros de la
venta Woo, devoluciones físicas y monetarias reales, webhook automático, corte
real y autorización productiva. No llamar a este ensayo una venta real conectada.


## Aceptación ejecutada

- Preview0.81.0 READY; avatar probado; commit publicado `28a24543` y árbol Git
  idéntico al local `6be7a7df0f69218acbadd0869fee0c7f82ed5b16`.
- Woo pruebas1.4.0 instalado; ocho controles OK y preflight del protocolo nuevo OK.
- Pedido49: solicitud `f578aaa5-ceb2-4882-abf5-a36dbce38d20`, código literal10582,
  tallaM, precio público82000 centavos, cantidad2 sintética.
- Pedido50: solicitud `fe7f6d19-17e8-4bef-b84f-eed511f5ca6a`, código literal10317,
  tallaM, precio público89000 centavos, cantidad2 sintética.
- Ambos pendientes→procesamiento→cancelados, verificados en Preview y Woo nativo.
  Una repetición UI por solicitud no aumentó los dos pedidos ni los cuatro eventos.
- Por pedido: reserva3físicas/2reservadas/1disponible; consume1/0/1; repone3/0/3.
  Tres replays de comandos, cero cambios nativos persistentes después del rollback.
- Auditoría146 tablas previa/final idéntica; los dos ensayos VERIFIED y sus cuatro
  eventos privados constituyen las únicas filas nuevas en Supabase.
- SQL15 rechazos+3 comandos+3replays;1050unitarias/119archivos; PHP32 y regresión
  fotos42+23; tipos/lint/build aprobados. Build local inicial falló al descargar
  Google Fonts en sandbox; repetición autorizada con red y build remoto aprobados.
- Migración local `20261021211818` aplicada remota `20261021212335`; ambas versiones
  se registran, sin reescribir la migración aplicada.
- Asesores: advertencias generales de funciones DEFINER y protección de contraseña
  filtrada revisadas; no se habilitó acceso general ni se cambiaron ajustes Auth.
  El RPC de escritura no tiene EXECUTE para anon/authenticated y la lectura valida
  ADMIN/propietario. El control de stock sigue deshabilitado y los conteos NULL.

## Reproducción y evidencia

Código en commit `39dca43`, publicado mediante GitHub Connector después de que
Git CLI no tuvo credenciales; `force=false` y lease del head `7aa2073`. Se verificó
igualdad exacta de árbol; historia local y remota conciliadas sin sobrescritura.
Vercel `dpl_CWoHgkcRvSiUXnhmetoLgsRSEcz1`, target Preview, Next.js, READY.
Credenciales existentes sólo del destino test; ninguna se publica en código/reportes.
La contraseña administrativa de pruebas no se conoce ni se cambió; Hostinger
permitió recuperar la sesión. Chrome no conservó una vista estable del formulario;
se completó en una pestaña aislada del navegador de Codex.

Evidencia privada local: `outputs/m9-pedido-remoto-preview-2026-10-21/`.
Pruebas reproducibles: `node_modules/.bin/vitest run tests/unit`,
`node scripts/m9/woo-remote/test-order-trial.mjs ../m9-woo-runtime`,
`node scripts/m9/woo-remote/test-variant-photo-write.mjs ../m9-woo-runtime` y
`node scripts/m9/woo-remote/test-variant-photo-read.mjs ../m9-woo-runtime`.
SQL: ejecutar
`scripts/m9/test-connected-woo-order.sql` únicamente en staging; termina ROLLBACK.
Los fixtures SQL/PHP son sintéticos; los pedidos49/50 sí son objetos Woo nativos
de prueba. No confundir ambas evidencias.

## Lo que sigue sin quedar aceptado

No hay captura automática de todos los movimientos POS para la salida de stock,
ni envío continuo de disponibilidad a Woo, ni carrera POS/Woo aceptada. Este bloque
usa lectura autenticada del pedido, no webhooks automáticos. No se validaron pago
real, documento financiero de venta Woo ni checkout público. Continúan la revisión
de entregas, conteo físico y corte vigente antes de autorizar producción. No cambió
la cobertura96.92% de catálogo ni se calculó un porcentaje global nuevo.
