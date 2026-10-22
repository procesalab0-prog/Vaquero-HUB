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
