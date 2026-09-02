# Escaneo con la cámara del teléfono

> Especificación transversal: es un componente compartido, no un
> milestone. Se introduce en M2 y su uso pesado está en M3 y M6.
>
> Última actualización: 2026-09-02.

**Estado de implementación:** el componente y su conexión con Productos están
terminados en 0.15.0. Siguen pendientes las pruebas físicas 5, 9, 10 y 11 con
la PWA instalada, iPhone, Android y etiquetas impresas reales.

## 1. Dónde se usa y dónde no

La regla de la sección 16 del contexto maestro se sostiene: **lector
físico para cobrar, cámara para moverse.**

| Uso                                        | Herramienta             | Por qué                                                                                                   |
| ------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| Cobrar en caja                             | Lector Bluetooth        | Un lector lee en ~100 ms; una cámara tarda de 1 a 3 segundos y a veces falla. Con fila, eso no se aguanta |
| **Conteos de inventario**                  | **Cámara del teléfono** | Andar el pasillo con el teléfono en la mano le gana a cargar iPad más lector                              |
| **Recepción de mercancía**                 | **Cámara**              | Mismo caso: se recibe de pie, junto a la caja de cartón                                                   |
| **Consulta rápida de existencia y precio** | **Cámara**              | Un vendedor en piso, con el teléfono que ya trae                                                          |
| Tarjeta de lealtad del cliente             | Cámara o lector 2D      | Ver sección 6                                                                                             |

La cámara no reemplaza al lector: lo complementa donde el lector estorba.

**Y no es una función nueva que estemos proponiendo: SICAR ya la tiene como
opción y el personal la usa.** Eso cambia su prioridad. No es un extra
agradable que se puede recortar si aprieta el calendario; es algo que hoy
tienen y que, si Mi Tienda SM no lo trae, se vive como un retroceso —de los
que hacen que la gente extrañe el sistema viejo aunque el nuevo sea mejor en
todo lo demás.

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
está viendo la pantalla: está viendo el anaquel. El _beep_ es lo que le
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

## 8. La cámara como banco de pruebas de los códigos generados

Hay un hueco que hoy no cierra nada, y la cámara lo cierra barato.

El generador de M2 ya emite EAN-13 y las pruebas de
[`CODIGOS_Y_SKU.md`](CODIGOS_Y_SKU.md) los dan por buenos — pero esa
verificación es **aritmética, no física**: recalcula el dígito de control
dentro de la base de datos. Nadie ha comprobado todavía que un código
generado, impreso en una etiqueta, **de verdad se lea con un aparato**.

Por qué importa más de lo que parece: un código generado es inmutable y
termina pegado en cajas. Si resulta que se imprime demasiado angosto, con
poco margen o con un contraste que no perdona, no hay corrección posible —
hay que reetiquetar todo lo que ya salió.

La cadena a comprobar es corta:

```
código generado  →  jsbarcode lo dibuja  →  se imprime  →  se escanea
                                                            ↓
                                        ¿devuelve los mismos 13 dígitos?
```

Lo bueno es que **no depende de nada bloqueado**. `jsbarcode` ya está en las
dependencias, y la cámara no necesita ni el lector Bluetooth ni el
controlador de la impresora, que son la fase de hardware. Se puede correr
hoy, antes que M2.5.

Vale la pena escanear en los dos soportes, porque fallan distinto:

- **En pantalla**, que es la prueba rápida de que el dibujo está bien.
- **Impreso**, que es la prueba de verdad: ahí es donde aparecen el ancho
  de barra, el margen y el contraste, y donde una etiqueta térmica gastada
  se comporta distinto a un PNG en un monitor.

**Lo que esta prueba no cubre, y conviene no confundir:** que un código
nuestro sea legible no dice nada sobre si choca con uno heredado de SICAR.
Eso es la compuerta de la sección 8 de `CODIGOS_Y_SKU.md`, que compara
contra la exportación de muestra y sigue bloqueada. Son dos riesgos
distintos y ninguno tapa al otro.

## 9. Pruebas

| #   | Escenario                                             | Resultado esperado                                  |
| --- | ----------------------------------------------------- | --------------------------------------------------- |
| 1   | Escanear un EAN-13 impreso, luz normal                | Lo detecta en menos de 2 segundos                   |
| 2   | Escanear el mismo código sin quitarlo del cuadro      | Se registra una sola vez                            |
| 3   | Escanear en penumbra con la linterna encendida        | Lo detecta                                          |
| 4   | Código inexistente en el catálogo                     | Mensaje claro y opción de darlo de alta             |
| 5   | Cámara dentro de la PWA instalada, iPhone y Android   | Funciona en ambos                                   |
| 6   | Permiso de cámara denegado                            | Explica cómo reactivarlo, no muestra pantalla negra |
| 7   | Conteo con la red caída a media sesión                | Sigue escaneando y encola; sincroniza al volver     |
| 8   | Escanear el QR de una tarjeta de lealtad en pantalla  | Encuentra al cliente                                |
| 9   | Escanear en pantalla un EAN-13 recién generado        | Devuelve los mismos 13 dígitos                      |
| 10  | Escanear el mismo código impreso en una etiqueta real | Lo detecta y coincide                               |
| 11  | Escanear una etiqueta impresa de SICAR                | Lo detecta; sirve de referencia de legibilidad      |

Las pruebas 9 y 10 son la sección 8 y conviene correrlas antes que el resto:
no dependen de M3 ni del hardware, y lo que descubren ya no se puede
corregir después.

## 10. Preguntas abiertas

1. ¿El personal usaría su propio teléfono para conteos, o el negocio
   pondría dispositivos? Cambia si hay que contemplar Android además de
   iOS, y con qué antigüedad.
2. ¿Qué tan legibles están las etiquetas actuales? Conviene una foto de
   una etiqueta real de SICAR para probar el lector contra el caso
   verdadero y no contra uno ideal.
