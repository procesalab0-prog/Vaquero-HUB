# Impresoras del mostrador

## Equipo confirmado, con modelo y placa a la vista

| Uso       | Modelo                  | Papel  | Interfaz    | Origen         |
| --------- | ----------------------- | ------ | ----------- | -------------- |
| Tickets   | **BIXOLON SRP-330II**   | 80 mm  | USB         | Made in Korea  |
| Etiquetas | **SICAR EVA58**         | 58 mm  | USB, RS232  | Made in China  |

Datos leídos de la placa de cada equipo, septiembre de 2026. La EVA58 la
fabrica «Ahora Resulta SA de CV», que es la empresa detrás de SICAR, y su
placa la describe como *Thermal Label & Receipt Printer* a 100 mm/s.

**No se compra impresora: el sistema funciona con estas dos.**

## Lo que las placas resuelven

1. **El ancho del ticket es 80 mm**, que es justo lo que el código asume en
   `lib/printing.ts`. Confirmado, no adivinado. La SRP-330II admite también
   rollo de 58 mm con una guía; si alguna vez se le pone, `RECEIPT_WIDTH_MM`
   es lo único que cambia.
2. **La etiqueta no puede pasar de 58 mm de ancho.** La plantilla por omisión
   es de 50 × 30 mm y cabe holgada. La base admite hasta 120 mm a propósito,
   para no amarrar el sistema a la impresora de hoy, pero la pantalla de
   etiquetas avisa cuando la medida se pasa del rollo real.
3. **Ninguna de las dos es de red.** La EVA58 lo dice en la placa: USB y
   RS232. Eso confirma por escrito lo que ya se había concluido: **el punto de
   venta que imprime corre en la computadora del mostrador, no en el iPad**,
   porque un iPad no tiene controladores y ninguna es AirPrint. El iPad se
   queda con catálogo, inventario, conteos y consulta.

## Cómo imprime el sistema

Ticket y etiqueta se generan como HTML y salen con `window.print()`, es decir
**por el controlador del sistema operativo**. Las dos impresoras ya tienen su
controlador instalado en la computadora del mostrador, porque es con lo que
opera SICAR hoy.

**El tamaño de rollo continuo se configura en el controlador de la BIXOLON, no
desde CSS.** Una revisión anterior había puesto `@page { size: 80mm auto }`
creyendo que así el ticket no alimentaría una hoja completa. Esa declaración es
inválida: la gramática de `size` admite `<length>{1,2}`, `auto` sola, o un
nombre de papel, pero no mezclar una medida con `auto`, así que el navegador
descartaba la regla entera y no hacía nada. Ya se retiró. La hoja de estilos
sólo quita márgenes y fija el ancho del contenido, que es lo que sí le toca.

## Antes de desinstalar SICAR

La EVA58 es hardware de marca SICAR y su controlador de Windows pudo haber
llegado dentro del instalador de SICAR. **Conseguir por separado el
controlador de la EVA58 y probar que instala solo, antes de desinstalar
nada.** Si el único que lo tiene es el proveedor, pedirlo mientras la relación
siga siendo buena.

## Lo que falta confirmar

1. **Ancho del rollo de tickets que compran hoy.** La impresora es de 80 mm y
   es lo esperable, pero conviene verlo en el rollo.
2. **Medida exacta de la etiqueta troquelada** que usan, en milímetros, y si
   viene de una o dos por fila.
3. **Cajón de dinero:** si está conectado al puerto de la BIXOLON, se abre
   configurando el controlador, no programando.

## La prueba física, frente al mostrador

- [ ] Cobrar una venta e imprimir el ticket. Verificar que no alimente papel de
      más al final y que el corte caiga donde debe. **Si alimenta de más, se
      corrige en el controlador**, poniéndole el tamaño de rollo continuo.
- [ ] Imprimir un ticket de regalo y confirmar que no muestra importes.
- [ ] Reimprimir un ticket ya cobrado desde la pantalla de tickets.
- [ ] Imprimir una etiqueta y **escanearla con la cámara del teléfono**. Es la
      misma prueba que cierra M2 y la que M9 pide como referencia: el código
      generado tiene que leerse impreso, no sólo en pantalla.
- [ ] Escanear esa etiqueta con el lector del mostrador.
- [ ] Si el cajón está conectado, confirmar que abre al cobrar en efectivo.
