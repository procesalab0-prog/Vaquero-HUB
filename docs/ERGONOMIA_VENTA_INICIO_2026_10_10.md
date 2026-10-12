# Ergonomía de Venta e Inicio — 10 de octubre de 2026

Solicitud de Emmanuel: preservar identidad y botones. Teléfono abre catálogo completo; escaneo suma al carrito sin cambiar pantalla; botón inferior muestra cantidad/total y abre carrito completo. Lista con scroll propio y cobro compacto; navegación inferior no tapa contenido. En computadora se conserva divisor, catálogo/venta simultáneos; carrito amplio usa tarjetas con imagen real y fallback explícito. Producto rápido: campos con borde visible.

Cliente y Herramientas comparten fila, con botones distintos. Herramientas y Más abren popovers en la capa superior: no encogen carrito ni ocupan el riel. En pantalla suficiente las opciones caben completas; en pantalla muy corta se conserva scroll del propio menú por accesibilidad. Más abre al costado en computadora; teléfono conserva menú arriba de navegación inferior.

Descuento, regalo global y apartado pasan a Confirmar cobro. Regalo por artículo permanece. Se conservan autorizaciones, cotizaciones, bloqueo de producto rápido para apartados y reglas de pago. Al pedir cliente o descuento, Confirmar cobro cede el foco a esa ventana y vuelve después. Apartar cierra el cobro, no crea una venta.

Inicio muestra accesos y métricas según permisos granulares comprobados en servidor; no cambia roles ni RLS. Sonido previamente habilitado se reactiva con gesto al recargar; no se activa si se eligió apagarlo. Campana/animación/avisos ya existentes se conservan. No se promete audio si el navegador está en segundo plano ni si el dispositivo está silenciado.

Sin migraciones SQL ni cambios de catálogo, existencias, WooCommerce o credenciales. Mantener staging M9 intacto. La maqueta local no sustituye las reglas del programa.

## Entrega privada candidata 0.64.0

Implementada en `codex/ergonomia-venta-inicio-octubre`. Compilación, tipos, lint y formato correctos; 159 pruebas unitarias y 298 recorridos completos de navegador, con dos pruebas de PWA omitidas por su configuración existente. Tras corregir visualmente las fotos se repitieron los ocho recorridos específicos, todos correctos. Capturas revisadas manualmente de carrito a 390 × 844 y escritorio a 1440 × 1000. Pruebas incluyen 320 × 568, 768 × 1024, scroll hasta el último artículo, cobro, descuento y retorno a Confirmar cobro, menú lateral, Escape y foto contenida.

Presentación por permisos comprobada con respuestas de servidor simuladas; no equivale a aceptación alojada con usuarios reales. Notificaciones: programación de audio y animación verificadas; altavoz, volumen y Safari físico requieren confirmación del usuario. La preferencia apagada se conserva. Las dos vistas privadas muestran la aplicación real en modo demostración, con datos de ejemplo, servida únicamente en 127.0.0.1:5940. No se ha publicado en main. No se ocupó staging de M9.

Siguiente aceptación: revisar ambas vistas con Emmanuel, comprobar cuentas reales con permisos distintos en ambiente coordinado y escuchar el sonido en los dispositivos de la tienda antes de promoción.

## Aprobación para main y últimos ajustes

Emmanuel autorizó el 10 de octubre publicar el rediseño en main después de añadir botones visibles de cerrar en Más y Confirmar cobro y colores a Descuento (ámbar), Regalo (morado) y Apartar (azul). Cerrar cobro conserva artículos, cliente y descuento; en teléfono vuelve al carrito abierto. Durante envío de cobro no permite cerrar. Sin cambios SQL ni escrituras a catálogo/inventario o WooCommerce. La publicación no acredita aceptación física del sonido ni aceptación de todos los roles con Auth alojado.
