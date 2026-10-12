# Correos de Mi Vaquero SM — preparación del 12 de octubre

Solicitado: acceso/registro por correo y tickets de compra. Remitente y proveedor pendientes de confirmación. No se enviaron mensajes reales ni se cambiaron DNS, Supabase Auth o variables de producción.

## Acceso

Ya existen /api/mi/acceso, /api/mi/registro y la verificación del código en Mi Vaquero. El acceso es sin contraseña; recuperar acceso consiste en solicitar otro código. No añadir un restablecimiento de contraseña que el cliente no utiliza. Preservar el límite de solicitudes, respuesta genérica y separación de empleados/clientes.

La plantilla docs/correos/acceso-supabase.html utiliza {{ .Token }}. Está lista para revisión, no aplicada. Supabase Auth comparte plantillas con el acceso del personal: el texto identifica ambos programas para no romper su experiencia. Confirmar en staging que las plantillas Magic Link y Confirm signup entregan el código esperado antes de cambiar producción.

Supabase recomienda SMTP propio para entregas reales a clientes. Configurar remitente/proveedor, autenticación del dominio y URLs de retorno autorizadas; no desactivar la verificación de correo para compensar fallos de envío.

Fuentes oficiales consultadas el 12 de octubre:
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/auth-email-templates

## Tickets

Mi Vaquero ya consulta get_my_customer_tickets bajo la sesión del cliente y permite descargar su PDF. lib/customer-ticket-email.ts prepara HTML y texto del aviso de ticket. No hay un envío real conectado todavía. El mensaje dirige a /mi y al historial privado, sin adjuntos o enlaces públicos que expongan compras.

Antes de conectar envío: elegir proveedor y obtener un remitente verificado; resolver destinatario desde cliente vinculado y correo verificado en servidor, nunca desde un campo libre del navegador. Crear cola persistente con clave única por venta/cliente/tipo, reintentos e historial de entrega. La venta confirmada no debe fallar porque el correo falle. Consultar sólo ventas autorizadas y no enviar pruebas sintéticas a clientes reales. La confirmación del dueño sobre promociones no sustituye permisos para datos de compra.

Aceptar primero en staging: cliente correcto, otra cuenta no ve su ticket, reintento no duplica correo, proveedor caído no revierte venta, código OTP recibido y utilizado. Para confirmar entrega real se necesita un correo de prueba elegido por Emmanuel.
