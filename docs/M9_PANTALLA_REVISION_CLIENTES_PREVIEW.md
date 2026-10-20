# Revisión de clientes SICAR y ensayo con Auth real

Diseño previo al cambio, 20 octubre 2026. Solicitud: pantalla de revisión y
prueba de vínculos/abonos desde Preview, sin producción.

Ruta de staging `/clientes/migracion-sicar`: resumen, búsqueda paginada,
documentos, abonos de origen/cancelaciones, líneas y entregas UNKNOWN. Sólo
ADMIN con customers.manage y autenticación vigente; no habilitar acceso por
ser simplemente authenticated. Tablas fuente siguen privadas sin grants.

RPC público SECURITY INVOKER delega a un dispatcher privado SECURITY DEFINER
con search_path vacío, comprobación explícita auth.uid/ADMIN/permisos/staging,
acciones cerradas y límites. No publica el importador de mantenimiento. La
interfaz puede guardar revisión pendiente/candidato, sin activar deuda real,
fusionar clientes ni registrar consentimiento. Los candidatos por teléfono
son sugerencias; nombre similar no aprueba identidad.

Para aceptar el flujo desde navegador, usar una fuente **SYNTHETIC_QA_NOT_SICAR**,
el cliente nativo preexistente como fixture y caja abierta del actor. Una
ventana privada temporal fija actor, fuente, destino y vencimiento. No crear
clientes ni consentimiento ficticio ni dar crédito nuevo.

El ensayo conserva únicamente su estado y comprobación en una tabla privada.
Cada acción reconstruye apertura y abonos previos dentro de una subtransacción,
llama al puente/RPC nativos, captura resultado y revierte esa subtransacción
antes de devolver. Así se prueba Auth → server action → PostgREST → libro/caja
nativos → respuesta/UI sin dejar cobros ni deuda sintéticos en las tablas
operativas. No emitir ticket válido, enviar correos ni presentar los resultados
de ensayo como abonos persistentes. Reintento con el mismo UUID devuelve el
mismo resultado; payload distinto debe fallar. Concurrencia bloquea por ensayo.

Probar consulta real, cuenta sin candidato, navegación/paginación, vínculo de
ensayo, abonos $4/$6 sobre $10, sobrepago, reintento y saldo cero, con sesión
real en Preview. Verificar auditoría de tablas operativas y las 61 cuentas
reales antes/después; cerrar ventana de ensayo al terminar. Fuera de Preview,
sin sesión o rol correcto: denegado. Main, SICAR, Woo y producción intactos.
