# Impresoras del mostrador

## Equipo confirmado

- Tickets: impresora térmica BIXOLON de 80 mm conectada a la computadora del
  mostrador.
- Etiquetas: impresora entregada con SICAR.

Ambas trabajan mediante el controlador de impresión del sistema operativo. La
web abre el diálogo de impresión y el usuario selecciona la impresora; no se
requiere una conexión directa a la impresora desde el navegador.

## Regla del ticket

El ticket fija `80 mm` de ancho y no impone una altura de página. El tamaño de
papel continuo debe quedar configurado en el controlador de la BIXOLON; CSS no
admite la combinación no estándar `size: 80mm auto`. Antes del piloto se debe
imprimir un ticket real, comprobar corte, márgenes, legibilidad del logo y
código, y guardar la configuración correcta del controlador.

Esta validación física sigue pendiente: una vista previa o una prueba PDF no la
sustituye.
