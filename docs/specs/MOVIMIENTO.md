# Movimiento de marca en Mi Tienda SM y Mi Vaquero

Implementado en la versión 0.58.0 a petición de Emmanuel (7 y 8 de octubre de
2026). Aplica las reglas de la sección «Movimiento y animación» del Plan
Maestro y los criterios de `REDISENO_MI_TIENDA.md`.

## Reglas que no se negocian

1. **Lo que se mueve no recibe toques; lo que recibe toques no se desplaza.**
   Un botón puede aparecer con opacidad, nunca cambiar de lugar bajo el dedo.
   «Nueva venta», el formulario de acceso y los accesos de Inicio funcionan
   desde el primer cuadro.
2. **Nunca agrega espera.** Cualquier toque o tecla termina la entrada al
   instante; las teclas del lector de códigos siguen su camino.
3. **Sólo se celebra lo que el servidor confirmó**: una venta registrada, un
   traspaso que cambió de estado, puntos que ya están en el historial.
4. **Sólo se anima `opacity`, `transform`, `clip-path`** y el trazo de íconos
   pequeños. Nada que obligue a recalcular la página en cada cuadro.
5. **Nada en bucle**, salvo el progreso mientras el sistema de verdad espera
   (pantalla de carga y botón «Verificando…»).
6. **`prefers-reduced-motion: reduce` apaga todo.** Todo el movimiento vive
   dentro de `@media (prefers-reduced-motion: no-preference)`.
7. **Sin dependencias nuevas.** CSS y una sola cuenta con
   `requestAnimationFrame` en Mi Vaquero. Sin Lottie, GSAP ni Framer Motion.
8. **Marca sin deformar.** El logotipo se revela con máscara, nunca se estira
   ni se le agregan brillos; sólo colores de la identidad (negro, hueso, café,
   arena `#9b7b57`).

## Los momentos

| Momento | Qué se ve | Cuándo |
| --- | --- | --- |
| **Acceso** | El logo se «marca» de izquierda a derecha con una línea arena, como hierro; «Operación · Punto de venta» se revela; el titular sube línea por línea desde su máscara; la tarjeta aparece. | Escena completa la primera vez del día en el dispositivo; después versión corta (200 ms). Al volver por un error, nada. |
| **Verificando** | Una línea arena recorre el borde inferior del botón. | Sólo mientras el servidor responde. |
| **Pantalla de carga** | Panel negro con el logo y «Abriendo Mi Tienda SM…» con línea de progreso. Reemplaza al antiguo texto suelto «Cargando sucursal…». | Cada vez que se abre el programa y justo después de entrar, mientras el sistema carga. Nunca agrega tiempo. |
| **Entrada** | El panel negro de la carga se recoge hacia el riel negro del sistema (en teléfono y iPad vertical, la franja sube); la barra superior aparece. 620 ms, sin bloquear. | Cada vez que se abre el programa, una vez por sesión. No se repite al navegar ni al cambiar de sucursal. |
| **Inicio** | El saludo sube por su línea; en el encabezado de marca se traza el borde punteado, se revela «VAQUERO SM» y el logo, y crece el círculo; las métricas suben y las tarjetas con accesos aparecen sin desplazarse. | Cada visita a Inicio. |
| **Agregar al carrito** | El renglón se ilumina por detrás con una marca del color de acento, la cantidad late y el contador del botón de carrito en teléfono también. | Cada artículo agregado; cada escaneo reinicia el destello sin encolarse. |
| **Venta completada** | El sello cae, un anillo se abre, la palomita se traza y el monto sube. | Sólo en venta confirmada. Una venta cancelada no se celebra. |
| **Traspasos** | Recorrido Enviado → En tránsito → Recibido con texto siempre visible y una frase de estado («En camino de La Piedad a Zamora»). El camión avanza y el nodo se marca. | Avanza animado cuando el estado cambia frente a quien lo mira (al enviar o recibir); al abrir la lista se ve quieto en su punto. |
| **Mi Vaquero · puntos** | El saldo cuenta hacia arriba desde el anterior, una estrella de espuela se abre alrededor y aparece «+N puntos de tu compra». | Si el movimiento más reciente es una compra de las últimas 48 horas; una vez por sesión de la app. |
| **Mi Vaquero · canje** | El código temporal cae como sello sobre papel, con un anillo arena. Se lee de inmediato. | Cada código generado. |

## Lo que no se hizo y por qué

- **Niveles en Mi Vaquero.** El sistema no tiene niveles: el motor de puntos,
  redención, cumpleaños y niveles sigue pendiente de decisión del cliente
  (sección 6 de `PREGUNTAS_CLIENTE.md`). No se inventa una regla de lealtad para
  poder animarla. Cuando exista, el estallido de espuela es el punto de partida.
- **Video (Higgsfield).** Para el acceso y la carga se prefirió movimiento en
  código: pesa casi nada, funciona sin conexión estable y respeta el movimiento
  reducido. El video queda para piezas de bienvenida o capacitación.
- **Sin guardar nada en el dispositivo de Mi Vaquero.** La celebración de puntos
  se decide con el historial que llega del servidor, porque Mi Vaquero promete
  conservar sólo el número de socio.

## Dónde vive

- `app/motion.css` — todo el movimiento de Mi Tienda (acceso, carga, entrada,
  Inicio, POS y traspasos). Formateado con Prettier; `format:check` no cubre
  `app/`, así que hay que formatearlo a mano.
- `app/mi/mi-motion.css` — Mi Vaquero.
- `lib/entrance.ts` — escena del acceso (cookie `mts_movimiento_dia`, sólo de
  animación: no lleva identidad ni autoriza nada).
- `components/workspace-boot.tsx`, `components/entrance-curtain.tsx` — carga y
  telón. Comparten medidas: si cambia una, cambia la otra.
- `lib/transfer-progress.ts`, `app/(workspace)/inventario/transfer-progress.tsx`.
- `lib/loyalty-motion.ts`, `app/mi/points-balance.tsx`.

## Cómo se comprobó

- Pruebas unitarias de la escena del acceso, del recorrido de traspasos (texto
  siempre presente, paso actual marcado, cancelado sin camión) y de la
  celebración de puntos (ventana de 48 h, sólo compras, sin saldo negativo).
- `tests/e2e/motion.spec.ts` en computadora y teléfono: escena completa, corta y
  ninguna; movimiento reducido; el telón se recoge solo, no se repite al
  navegar, una tecla lo termina y nunca recibe toques; cada escaneo reinicia el
  destello; «Nueva venta» no se anima y responde de inmediato.
- Revisión visual congelando las animaciones en varios instantes: el primer
  cuadro del telón es idéntico a la pantalla de carga, así el relevo no se nota.

## Pendiente de comprobar en la tienda

- iPad del mostrador, vertical y horizontal: que la entrada se sienta fluida.
- Computadora del mostrador: abrir el programa, cobrar y escanear sin esperar.
- Mi Vaquero en un teléfono real después de una compra.
