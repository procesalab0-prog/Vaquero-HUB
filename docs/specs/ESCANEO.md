# Escaneo con la cámara del teléfono

> Especificación transversal: es un componente compartido, no un
> milestone. Se introduce en M2 y su uso pesado está en M3 y M6.
>
> Última actualización: 2026-09-01.

## 1. Dónde se usa y dónde no

La regla de la sección 16 del contexto maestro se sostiene: **lector
físico para cobrar, cámara para moverse.**

| Uso | Herramienta | Por qué |
|---|---|---|
| Cobrar en caja | Lector Bluetooth | Un lector lee en ~100 ms; una cámara tarda de 1 a 3 segundos y a veces falla. Con fila, eso no se aguanta |
| **Conteos de inventario** | **Cámara del teléfono** | Andar el pasillo con el teléfono en la mano le gana a cargar iPad más lector |
| **Recepción de mercancía** | **Cámara** | Mismo caso: se recibe de pie, junto a la caja de cartón |
| **Consulta rápida de existencia y precio** | **Cámara** | Un vendedor en piso, con el teléfono que ya trae |
| Tarjeta de lealtad del cliente | Cámara o lector 2D | Ver sección 6 |

La cámara no reemplaza al lector: lo complementa donde el lector estorba.

## 2. Cómo se implementa

**Detección nativa donde existe, respaldo donde no.**

- `BarcodeDetector`, la API nativa del navegador, está en Android y no en
  Safari. Donde exista se usa: es más rápida y consume menos batería.
- En iOS se cae a **ZXing** (`@zxing/browser`), que cubre las simbologías
  que importan: EAN-13, Code128, QR.

Un solo componente expone la misma interfaz y decide por dentro cuál
motor usar. El resto de la aplicación no se entera.

## 3. Los detalles que deciden si sirve

Un lector de cámara mal hecho es peor que no tenerlo. Cinco requisitos que
no son opcionales:

**1. Región de escaneo acotada.** No se analiza el cuadro completo: se
dibuja un rectángulo guía y sólo se procesa esa zona. Es varias veces más
rápido y mucho más preciso, además de que le dice al usuario dónde
apuntar.

**2. Linterna.** Los códigos en cajas de cartón y en etiquetas pequeñas
viven en pasillos mal iluminados y en la bodega. Sin botón de linterna, el
escaneo falla la mitad de las veces y nadie sabe por qué.

**3. Confirmación por sonido y vibración.** Quien cuenta inventario no
está viendo la pantalla: está viendo el anaquel. El *beep* es lo que le
dice que ya quedó. Sin eso, se cuenta dos veces o se salta mercancía.

**4. Anti-repetición.** En escaneo continuo el mismo código se detecta
muchas veces por segundo. Se ignora el mismo código durante un par de
segundos, o hasta que salga del cuadro. Sin esto, un solo par de botas se
cuenta quince veces.

**5. Códigos 1D son mucho más difíciles que QR.** Un EAN-13 pequeño en una
etiqueta exige enfoque cercano y buena luz; un QR perdona casi todo. Como
los códigos heredados de SICAR probablemente sean 1D, el componente tiene
que estar afinado para ese caso, que es el difícil, no para el fácil.

## 4. Riesgo a verificar temprano: la cámara dentro de una PWA instalada

En iOS hubo un periodo en que `getUserMedia` funcionaba en Safari pero
**fallaba dentro de una PWA instalada en la pantalla de inicio**. Hoy
debería estar resuelto, pero es exactamente la clase de problema que
aparece tarde y de la peor forma: la app funciona en pruebas desde Safari
y falla en los dispositivos reales del personal, que la tienen instalada.

**Se verifica en M2, con un iPhone y un Android reales, con la PWA
instalada, no sólo desde el navegador.** Si falla, hay que saberlo antes
de construir conteos y recepción encima.

## 5. Conexión intermitente durante conteos

El conteo es, de todo el sistema, lo que más se hace donde peor llega la
señal: la bodega y el fondo de la tienda.

Escanear es local y no necesita red, pero resolver el código contra el
catálogo sí. Requisito mínimo para M3: **al abrir un conteo se precargan
en el dispositivo las variantes de su alcance**, y las cantidades contadas
se encolan y se envían cuando haya señal. Sin eso, el conteo se cae justo
donde más se usa.

Esto no es "modo offline" del POS (sección 31 del contexto maestro, que
sigue fuera de V1): es una caché acotada a una sesión de conteo, con un
alcance conocido y sin dinero de por medio.

## 6. La cámara como respaldo de la tarjeta de lealtad

Hay una conexión útil con M1B. El criterio de aceptación de ese milestone
es que el lector Bluetooth lea el QR del cliente desde la pantalla de un
teléfono, y ahí existe el riesgo de que un lector láser lineal no pueda.

**La cámara cubre ese caso.** Un QR en pantalla se lee muy bien con
cámara, así que aunque el lector físico no pueda, el personal puede
escanear la tarjeta con la cámara del iPad o del teléfono. Reduce el
riesgo de la decisión de hardware: la tarjeta digital funciona igual.

## 7. Permisos y primera vez

- El navegador pide permiso de cámara la primera vez. **Se explica antes
  de disparar el diálogo**, no después: una pantalla corta que diga para
  qué se va a usar.
- Si el permiso quedó denegado, no se puede volver a pedir desde la
  página: hay que mandar al usuario a los ajustes del sistema. La
  aplicación debe detectarlo y explicar el camino, no quedarse mostrando
  una cámara negra.

## 8. Pruebas

| # | Escenario | Resultado esperado |
|---|---|---|
| 1 | Escanear un EAN-13 impreso, luz normal | Lo detecta en menos de 2 segundos |
| 2 | Escanear el mismo código sin quitarlo del cuadro | Se registra una sola vez |
| 3 | Escanear en penumbra con la linterna encendida | Lo detecta |
| 4 | Código inexistente en el catálogo | Mensaje claro y opción de darlo de alta |
| 5 | Cámara dentro de la PWA instalada, iPhone y Android | Funciona en ambos |
| 6 | Permiso de cámara denegado | Explica cómo reactivarlo, no muestra pantalla negra |
| 7 | Conteo con la red caída a media sesión | Sigue escaneando y encola; sincroniza al volver |
| 8 | Escanear el QR de una tarjeta de lealtad en pantalla | Encuentra al cliente |

## 9. Preguntas abiertas

1. ¿El personal usaría su propio teléfono para conteos, o el negocio
   pondría dispositivos? Cambia si hay que contemplar Android además de
   iOS, y con qué antigüedad.
2. ¿Qué tan legibles están las etiquetas actuales? Conviene una foto de
   una etiqueta real de SICAR para probar el lector contra el caso
   verdadero y no contra uno ideal.
