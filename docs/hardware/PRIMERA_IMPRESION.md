# Primera impresión en la tienda

> Guía para la visita al mostrador. Está escrita para leerse en el teléfono
> mientras estás frente a la computadora.
>
> Objetivo de la visita: **imprimir un ticket, imprimir una etiqueta y
> escanearla con el teléfono.** Nada más. Si eso sale, el riesgo de hardware
> del proyecto queda cerrado.

## Lo importante en una línea

No hay nada que instalar. Abres Chrome, entras a la dirección del sistema, y
las dos impresoras ya están ahí porque sus controladores llevan años en esa
computadora. Lo que puede fallar no es el sistema: son los ajustes por omisión
del navegador y del controlador.

---

## Parte 1 — Antes de ir, desde donde estés

Estas tres cosas no se pueden resolver frente al mostrador si faltan, así que
conviene verificarlas antes.

- [ ] **Tienes un usuario tuyo**, con contraseña, que no sea el de pruebas.
- [ ] **La sucursal está dada de alta** y tu usuario tiene acceso a ella.
- [ ] **Existe una caja registrada en esa sucursal.** Entra a _Caja_: si no
      aparece ninguna, un administrador la crea ahí mismo con el botón de
      agregar caja. Sin caja no se puede abrir turno, y sin turno abierto la
      pantalla de Venta se bloquea.
- [ ] **La sucursal tiene dirección y teléfono capturados**, en _Ajustes_. Si
      están vacíos, el ticket imprime literalmente «Dirección por configurar» y
      «Teléfono por configurar». Es el detalle que arruina la primera
      impresión que le enseñas a alguien.

Si algo falta, se resuelve desde el celular en cinco minutos. Descubrirlo en la
tienda cuesta el viaje.

---

## Parte 2 — El ticket, sin vender nada

**Entra a _Más_ → _Prueba de impresión_.** Esa pantalla imprime un ticket de
muestra y **no registra ninguna venta**: no toca inventario, ni caja, ni
folios. Es el lugar correcto para calibrar.

### Ajustes del diálogo de Chrome, la primera vez

Cuando se abra el diálogo de impresión:

| Ajuste                       | Cómo debe quedar                    |
| ---------------------------- | ----------------------------------- |
| Impresora                    | **BIXOLON SRP-330II**               |
| Márgenes                     | **Ninguno**                         |
| Escala                       | **100 %**, no «Ajustar a la página» |
| Encabezados y pies de página | **Desactivados**                    |

Si dejas los encabezados, el ticket sale con la dirección web y la fecha
impresas arriba. Chrome recuerda estos ajustes.

### Si alimenta papel de más al final

**Eso no se arregla desde el sistema.** Es el tamaño de papel del controlador:

1. Windows → _Dispositivos e impresoras_
2. Clic derecho en **BIXOLON SRP-330II** → _Preferencias de impresión_
3. Tamaño de papel → el de **rollo continuo de 80 mm**
4. Aplicar y guardar

Se configura una vez y queda para siempre.

### Qué revisar en el ticket impreso

En la pantalla puedes activar **Todo en negritas** antes de imprimir. La
preferencia queda guardada en esa computadora y también se aplica al PDF que
descargue el personal desde Tickets.

- [ ] El logo se ve, no sale como mancha.
- [ ] Los nombres largos no se cortan a la derecha.
- [ ] Los acentos salen bien (el ticket de muestra trae «Cinturón» a
      propósito).
- [ ] El corte cae después del último renglón, no a media hoja.
- [ ] Imprime también el **ticket de regalo** y confirma que **no muestra
      precios**. Es el que se le da al cliente cuando el artículo es un regalo.

---

## Parte 3 — La etiqueta, y la prueba que de verdad importa

**Entra a _Más_ → _Etiquetas y códigos_.** Esa pantalla tampoco registra nada:
sólo dibuja etiquetas y las manda a imprimir.

1. Busca cualquier producto que ya exista.
2. Imprime **una sola etiqueta** para empezar. En el diálogo elige la
   **SICAR EVA58**, márgenes en Ninguno y escala 100 %.
3. La plantilla por omisión es de **51 × 25 mm**, la medida confirmada con el
   troquel real. En el controlador también debe existir papel de 51 × 25 mm;
   usa márgenes en Ninguno, escala 100 %, orientación horizontal y desactiva
   «Ajustar a la página».

La primera prueba a 50 × 30 mm y la segunda prueba con el logotipo sin recorte
cruzaron el corte entre dos etiquetas. La plantilla ahora recorta visualmente el
espacio transparente del PNG. No se debe compensar con una escala distinta de
100 %: el papel del controlador y la plantilla de Mi Tienda SM deben coincidir
ambos en 51 × 25 mm.

### Y ahora la prueba que cierra el riesgo del proyecto

**Escanea con la cámara del teléfono la etiqueta que acabas de imprimir**,
desde la pantalla de Venta del sistema.

Esto es lo único que demuestra que los códigos que genera Mi Tienda SM sirven
en el mundo físico y no sólo en pantalla. Si el código no lee impreso, hay que
ajustar el tamaño de barra o el contraste **antes** de etiquetar mercancía, no
después.

- [ ] La cámara lo lee y encuentra el producto.
- [ ] El lector del mostrador también lo lee.

---

## Parte 4 — Si quieres además probar una venta real

Sólo si te sobra tiempo. La prueba de impresión de la Parte 2 ya cubre la
calibración, así que esto es opcional.

Una venta en producción **es una venta real**: descuenta inventario, genera
folio y deja el dinero esperado en la caja. Si la haces:

1. Abre caja con el fondo real.
2. Cobra un artículo de prueba.
3. Imprime el ticket.
4. **Cancela la venta** desde _Tickets_. El inventario regresa y la caja se
   ajusta sola.
5. Cierra el turno para no dejar una caja abierta colgada.

---

## Lo que hay que traer de regreso

Son las respuestas que siguen bloqueando decisiones del proyecto:

| Dato                                              | Dónde se ve                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| Medida de la etiqueta troquelada, en milímetros   | En la caja del rollo, o midiéndola                               |
| Ancho real del rollo de tickets                   | En la caja del rollo                                             |
| Si el cajón de dinero está conectado a la BIXOLON | Mirando el cable atrás de la impresora                           |
| Si la BIXOLON tiene puerto de red (RJ45)          | Mirando atrás; abre la puerta a imprimir desde iPad más adelante |
| Foto de una etiqueta impresa por SICAR            | Para comparar simbología con la nuestra                          |

---

## Lo que no va a funcionar, y conviene saberlo desde hoy

**Sin internet no se vende.** El sistema vive en la nube y la pantalla de
mostrador no tiene modo desconectado. Para una prueba de impresión no importa,
pero para abrir la sucursal en octubre hay que tener decidido el plan B de
conexión.

**Cada impresión va a pedir escoger impresora.** Para la prueba está bien. Para
operar todo el día es fricción real en cada venta; la solución está en la cola
de trabajo como tarea para Codex.
