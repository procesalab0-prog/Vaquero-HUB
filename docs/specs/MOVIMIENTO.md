# Movimiento de marca en Mi Tienda SM y Mi Vaquero

Implementado en las versiones 0.58.0 y 0.59.0 a petición de Emmanuel (7 y 8 de
octubre de 2026). Aplica las reglas de la sección «Movimiento y animación» del Plan
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

## Segunda ronda (0.59.0)

| Momento | Qué se ve | Cuándo |
| --- | --- | --- |
| **Todos los botones** | Una huella de luz nace donde cae el dedo y se apaga en menos de medio segundo; en botones oscuros es clara, en claros es café. Se conserva el «hundido» que ya tenían y ahora también se ve en iPad y iPhone. Vibración de 8 ms en teléfonos Android, con interruptor en Ajustes › Apariencia. | Cualquier botón, enlace o pestaña, en Mi Tienda y Mi Vaquero. Si el toque se vuelve desplazamiento, la huella desaparece y no vibra. |
| **Campana** | Se mece con cada aviso nuevo; el punto rojo se vuelve un contador de avisos sin leer que salta al llegar otro; el aviso entra desde arriba con una barra que muestra los 5 segundos que le quedan. | Al llegar avisos de Venta, Compras, Caja, Devoluciones o la prueba de Ajustes. El contador se limpia al abrir la campana. |
| **Apartados** | Cada apartado muestra una barra de lo pagado con su porcentaje escrito. Al registrar un abono, la barra de ese apartado se llena desde lo que había antes, cuando queda a la vista; si el abono lo liquidó, cae el sello «Liquidado». | La barra siempre; el llenado y el sello sólo al volver de registrar un abono confirmado. |
| **Tarjeta de socio** | Un destello diagonal cruza la tarjeta, como luz sobre una tarjeta nueva. Sobre la cara blanca del código es apenas un tono arena, para no quitar contraste a las barras. | Al aparecer, una vez por sesión de la app, y cada vez que se voltea para mostrarla en caja. |

Sobre la vibración: **iPad y iPhone no permiten vibrar desde una página web**
(Safari no implementa esa función). Ahí la respuesta es la huella de luz y el
«hundido». Ajustes lo dice en el propio interruptor.

La huella es una sola capa flotante que se coloca sobre el botón tocado: no
cambia el estilo, la posición ni el tamaño de ningún botón, y nunca recibe
toques. La campana conserva su nombre accesible «Notificaciones»; cada aviso ya
se anuncia por voz al llegar.

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
- `lib/press-feedback.ts`, `components/press-feedback.tsx` (montado en
  `app/layout.tsx`), `components/haptics-setting.tsx`.
- `lib/layaway-progress.ts`, `app/(workspace)/apartados/layaway-progress.tsx`.
- Campana: `components/workspace-shell.tsx`. Tarjeta: `app/mi/member-card.tsx`.

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

- iPad: que el «hundido» de los botones ya se vea al tocar.
- Teléfono Android: que la vibración se sienta corta y se pueda apagar.
- Un abono real en Apartados que liquide un apartado.

- iPad del mostrador, vertical y horizontal: que la entrada se sienta fluida.
- Computadora del mostrador: abrir el programa, cobrar y escanear sin esperar.
- Mi Vaquero en un teléfono real después de una compra.
