# M9 · Cola automática de ensayos Woo · Plan

Unir pedido sintético y disponibilidad en un trabajo persistente, conservando el
mismo UUID en Mi Tienda y Woo. Dos fases: pedido cancelado con inventario local
revertido, y disponibilidad sintética con restauración de padre/variación. No
procesar pedidos de clientes, cobrar, abrir compra pública ni cargar existencias.

Una ventana privada ADMIN/La Piedad de hasta veinte minutos autoriza sólo las dos
familias ya verificadas. Cola y eventos privados con RLS; ningún cliente recibe
credenciales. El trabajador obtiene una concesión de 120 segundos; cada llamada
externa y cada RPC comprueba su token vigente. Ejecución máxima 80 segundos,
una fase por invocación. Recuperar una concesión vencida cambia el token y bloquea
confirmaciones antiguas. Confirmar una fase exige comprobar sus recibos SQL.

Reintentos automáticos limitados a tres por fase, con espera creciente, sólo por
fallos transitorios. Una identidad distinta, protección fallida, intención remota
incierta o restauración no comprobada queda en revisión; nunca se repite un POST
incierto ni se inventa otra solicitud. Se mantiene el límite de cinco pedidos
nuevos en 24 horas del ensayo existente.

El programador de staging invocará únicamente la ruta fija de Preview mediante
pg_cron/pg_net. Token generado dentro de Vault; Vercel recibe sólo su hash. Ruta
de servidor autenticada, sin actor, destino o pedido arbitrarios en el cuerpo.
Sin una ventana vigente y trabajos debidos no hay peticiones externas. Cerrar
ventana y desprogramar el ensayo al finalizar; no dejar automatización operativa.

Validar rechazos, dos trabajadores, recuperación de concesión, caída entre fases,
respuestas perdidas y reintentos agotados. Ensayo SQL con ROLLBACK y pruebas de
cliente con fallos inyectados. Después publicar sólo Preview y comprobar desde
sesión real un trabajo completo ejecutado por el programador, sin botón de envío
por fase. Auditoría antes/después de las tablas preexistentes y stock Woo igual
al original. Una programación real no se considera aceptada con una prueba local.

Documentación consultada: [programación Supabase](https://supabase.com/docs/guides/functions/schedule-functions),
[pg_net](https://supabase.com/docs/guides/database/extensions/pg_net),
[duración Vercel](https://vercel.com/docs/functions/configuring-functions/duration).
Índice de cambios Supabase revisado; no se usan cifrados TLS/PGP obsoletos ni se
actualiza PostgreSQL como parte de este bloque.


## Acceso protegido a Preview

El primer tick llegó a Vercel Authentication, sin alcanzar el trabajador ni crear
pedido. Se pausó el programador. La corrección0.83.1 usa `@vercel/oidc`4.0.0 para
leer en servidor la identidad efímera del propio proyecto/Preview y guardarla
cifrada en Vault sólo durante la ventana. SQL valida proyecto, equipo, entorno,
emisor, audiencia y vigencia; no usa ese parseo como autenticación. Vercel verifica
la firma al recibirla. El programador añade `x-vercel-trusted-oidc-idp-token`, además
del bearer limitado al trabajador. No se desactiva Vercel Authentication ni se
crean reglas de acceso entre entornos o credenciales de bypass permanentes.
Cada invocación renueva la identidad desde el contexto del servidor. Si falta o
vence se detiene; cerrar la prueba limpia identidad/vigencia y desprograma cron.
Ver [Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources).


## M9 · Cola automática Woo aceptada en Preview0.83.1 · 21 octubre 2026

Preview0.83.1 READY, commit98d67ecae9299ddd54cac985aae64c23324f1801,
árbolfd277e71f87cef0548f9d3bdce0c493e2d19cfae,
deployment dpl_6qREBmasqAF2k2AhS6ySTBVDBLoW. Avatar comprobado.
La entrega0.83.0 c10af8b publicó la cola pero su primer tick fue rechazado por
Vercel Authentication; no se contó como aceptación. Corrección usa identidad
efímera del propio proyecto/Preview, @vercel/oidc4.0.0 y Vault, sin desactivar
protección ni ampliar reglas Trusted Sources. El navegador no recibe tokens.

Aceptado: solicitud87427c06-b889-41a1-960b-930b1ed8e8df guardada por UI/Auth,
pedido sintético Woo54, código10582/tallaM/$820/2 piezas de ensayo. Cron2 ejecutó
ORDER a00:12UTC y AVAILABILITY a00:13UTC del22 (tarde21 México), HTTP200 en ambas.
No se pulsaron botones por fase. EstadoDONE/COMPLETE, claims2, cinco eventos:
ENQUEUE,CLAIM,ADVANCE,CLAIM,DONE. Pedido cancelado, sin pago/envío/cliente;
inventario local con rollback y Woo con checkpoints3→1→0→1→1→3, campos de padre
y variación iguales antes/después. Relectura técnica confirma recibos/identidad.

Reencolar la misma solicitud terminada mantuvo claims2/eventos5 y cinco pedidos
sintéticos acumulados/24h, sin crear sexto. Recuperación adicional del pedido52
fa7c3585-be58-45af-94f7-ee4839f06b03: DONE/claims2, sin nuevo pedido. Durante su
faseAVAILABILITY dos peticiones HTTP simultáneas7/8 recibieron IDLE y DONE; sólo
un CLAIM para la fase. Dos trabajos, diez eventos permanentes de cola. HTTP real
con OIDC válido pero bearer incorrecto rechazado401; cuerpo arbitrario400.

1,100 unitarias/122 archivos, tipos/lint/build PASS. SQL13 rechazos de cola y11
de identidad; concesión vencida/tokens antiguos, espera30/60s, límite3 por fase,
identidad incierta en revisión, fases sólo con recibosVERIFIED, privilegios y
rotación cifrada. Fixtures repetidas después del cierre desde estado apagado,
todo ROLLBACK. La fixture de fases requiere un recibo previamente aceptado todavía
no encolado; selecciona uno del mismo ADMIN y conserva el dataset. La fixture de
identidad abre su ventana sólo dentro de la transacción y rechaza una ya activa.
No se usa una fixture SQL como prueba de firma OIDC o transporte real.

Auditoría146 preexistentes idéntica antes/después y tras repetir fixtures. Outbox/
eventos de disponibilidad vacíos, captura y sonda apagadas. Control worker false,
actor/window/expires/identity_expires NULL; cron desprogramado (0 jobs), identidad
efímera en Vault reemplazada por revoked. No fuente SICAR, costos, existencias
reales, caja o documentos financieros modificados. Se conservan pedido54/recibos,
un connected_trial y dos connected_events nuevos, un recibo de disponibilidad,
dos jobs/diez eventos de cola, además de metadatos propios de cron/Vault.

Migraciones local20261021235314→remota20261021235614 y
local20261022000552→remota20261022000730, sin editar SQL aplicado.
Advisors: RLS privado sin políticas por diseño; WARN previos de funciones definer
autorizadas y protección de contraseñas filtradas sin cambio. RPC de trabajador/
identidad sólo service_role; tablas privadas/RLS, status sólo ADMIN propietario.

Ver docs/M9_COLA_AUTOMATICA_WOO_STAGING.md y evidencia privada en
outputs/m9-cola-automatica-2026-10-21/, verificar.mjs y manifest.json.
Esto acepta automatización ACOTADA de ENSAYOS, no sincronización de existencias
operativas ni ventas reales. Pendientes: trabajador de stock con revisión
operativa/versionado, roles operativos, pedidos reales y documentos financieros/
tickets, carrera financiera checkout/POS, corte físico y entregas/apartados,
renovación final de fuentes y autorización por etapas. Cobertura catálogo96.92%
sin cambio; no porcentaje global. No main ni producción.
