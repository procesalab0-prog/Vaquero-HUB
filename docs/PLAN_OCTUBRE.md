# Plan de octubre — apertura de la segunda sucursal

> Replantea el calendario ante una fecha con evento de negocio detrás: en
> octubre abre la segunda sucursal, y el equipo pasa a dos programadores.
>
> Sustituye las estimaciones de `PLAN_CODEX.md` sección 5 para el periodo
> septiembre–octubre. El orden de milestones no cambia; cambia qué entra
> en el alcance de octubre y qué se recorre a enero.
>
> Fecha: 2026-09-01.

## 1. La decisión estratégica

**La sucursal nueva abre operando en Vaquero Hub. La sucursal 1 sigue en
SICAR hasta enero.**

No se intenta el reemplazo completo para octubre — no cabe, y forzarlo
significaría recortar devoluciones o corte de caja, que es justo lo que
deja a una tienda sin poder operar.

La razón por la que esto funciona: **la sucursal nueva no tiene operación
que interrumpir.** Sin inventario heredado, sin personal con costumbres de
SICAR, sin ventas que se puedan caer. Es el escenario de menor riesgo de
todo el proyecto, y llega solo. Un piloto real, con ventas reales, con el
radio de daño acotado a una tienda que de todas formas está arrancando.

Comparado con el plan anterior, esto **adelanta** el piloto en lugar de
atrasarlo: en vez de simular ventas en paralelo durante turnos de prueba,
se opera de verdad en un lugar donde equivocarse cuesta poco.

## 2. Qué entra en el alcance de octubre

Lo mínimo para que una tienda pueda abrir y vender:

| Milestone | Por qué es indispensable |
|---|---|
| **M1** — identidad, roles, sucursales | El modelo multisucursal es el corazón de esto |
| **M2** — catálogo, variantes, códigos, etiquetas | Sin catálogo no hay nada que vender |
| **M3** — inventario, movimientos y **traspasos** | Con dos tiendas, mover mercancía deja de ser opcional |
| **M4** — POS, pagos mixtos, caja y cortes | Es la caja |
| **M5** — devoluciones, cambios y cancelaciones | El primer cliente que vuelva con la talla equivocada |
| **M9** — importador de catálogo desde SICAR | Es de donde salen los productos |

## 3. Qué se recorre a después de octubre

- **M1B** — clientes y tarjeta de lealtad. Duele dejarlo, pero una tienda
  abre sin programa de puntos.
- **M6** — compras y proveedores. La mercancía inicial de la sucursal
  nueva entra por traspaso o por captura directa; las compras siguen en
  SICAR unos meses.
- **M7** — apartados, crédito y puntos. **Con una salvedad, ver 3.1.**
- **M8** — reportes avanzados, cotizaciones, envío de tickets. En octubre
  van sólo los reportes básicos de venta y existencias.

### 3.1 Apartados: la excepción que hay que confirmar ya

Si la tienda nueva va a manejar apartados desde el día uno, **entran al
alcance de octubre** y hay que decirlo esta semana, porque son unos cinco
días de trabajo y afectan el modelo de inventario (la mercancía apartada
se reserva y sale de disponible).

Es la pregunta más urgente de todas: **¿la sucursal nueva va a apartar
mercancía desde que abre?**

## 4. La convivencia: dos tiendas, dos sistemas

Durante los meses de coexistencia hay reglas que no se pueden dejar al
criterio del momento.

**El inventario queda partido.** La sucursal 1 vive en SICAR, la 2 en
Vaquero Hub. Consecuencias que conviene aceptar de frente:

- Vaquero Hub **no sabe** cuánta existencia hay en la sucursal 1. La
  pregunta «¿tienen esa talla en la otra tienda?» no se contesta desde el
  sistema durante este periodo.
- El catálogo sí es común: se sincroniza semanalmente desde SICAR, así que
  los productos y los códigos son los mismos en ambos lados.

**Traspasos entre sucursales, mientras dure:** salida capturada en SICAR y
entrada en Vaquero Hub como movimiento con su referencia. Es manual y hay
que documentar el procedimiento en una hoja, con un responsable por
traspaso. No es elegante, pero es acotado y temporal.

**Dónde se capturan los productos nuevos:** en SICAR, y el sincronizador
los trae. Así el catálogo tiene un solo dueño durante la convivencia y no
nacen códigos duplicados. Esto responde la pregunta 8.4 de
`PREGUNTAS_CLIENTE.md`.

## 5. Reparto entre dos programadores

El plan maestro ya advierte en la sección 38 que dos agentes no deben
tocar las mismas partes sin coordinación. Con dos programadores y dos IAs
distintas ese riesgo se multiplica, así que el reparto tiene que ser
explícito.

| Quién | Qué | Por qué así |
|---|---|---|
| **Programador 1 — datos** | M1, M3, M9 y **todas las funciones críticas de PostgreSQL** (`apply_movement`, `create_sale`) | Aquí un error se paga carísimo y dos manos son peor que una |
| **Programador 2 — catálogo e interfaz** | M2, la interfaz del POS en M4, la de M5 | Es donde el trabajo sí se puede paralelizar |

**Regla dura: las funciones críticas de PostgreSQL tienen un solo dueño.**
Nadie más las toca. Si el programador 2 necesita un cambio ahí, lo pide;
no lo hace.

Las especificaciones de `docs/specs/` se vuelven más importantes ahora que
antes: son el contrato compartido que evita que dos personas con dos IAs
distintas construyan dos sistemas diferentes.

## 6. Calendario

Seis semanas y media, unos 32 días hábiles, con dos programadores:

| Semanas | Programador 1 | Programador 2 |
|---|---|---|
| 1–1.5 | M1 — identidad, roles, sucursales, RLS | M2 — catálogo y variantes |
| 2–3 | M3 — inventario y traspasos | M2 — carga masiva y etiquetas |
| 3–4 | M9 — importador y sincronizador | Interfaz de catálogo e inventario |
| 4–5.5 | `create_sale`, pagos, caja | Interfaz del POS |
| 5.5–6.5 | M5 — devoluciones y cambios | Reportes básicos y ajustes |

**No hay holgura.** Cualquier sorpresa se come la fecha, así que la
sección 7 no es una recomendación: es la condición para que el calendario
se sostenga.

## 7. Lo que tiene que pasar esta semana o la fecha se cae

1. **Junta con el cliente recorriendo `PREGUNTAS_CLIENTE.md` completa.**
   M4 y M5 tienen preguntas bloqueantes y llegan en la semana 4. No hay
   margen para esperar respuestas a mitad del camino.
2. **Confirmar si la sucursal nueva maneja apartados desde el día uno**
   (sección 3.1).
3. **Comprar y probar la impresora térmica y el lector.** Si la impresora
   no imprime desde el navegador, cambia la arquitectura del POS. Eso hay
   que saberlo en la semana 1, no en la 5.
4. **Conseguir la exportación de SICAR** para diseñar el catálogo contra
   datos reales.
5. **Lista de empleados de la sucursal nueva con su rol**, y cuántas cajas
   va a tener.

## 8. Plan de respaldo

Abrir una sucursal ya es de por sí una operación tensa; hacerlo sobre
software nuevo le suma riesgo a un momento que ya lo tiene. Hay que tener
salida:

- **Confirmar si se puede instalar SICAR en la sucursal nueva como
  respaldo**, aunque no se use. Depende de la licencia, y conviene
  averiguarlo ahora.
- **Punto de decisión en la semana 5.** Si a esa altura M4 no está
  estable, se abre la sucursal con SICAR y Vaquero Hub entra unas semanas
  después. Esa decisión se toma con una semana de margen, no la víspera.
- La sucursal 1 no se toca en todo octubre. Pase lo que pase, el negocio
  principal sigue operando igual.

## 9. Lo que no cambia

El corte de la sucursal 1 sigue siendo en **enero**, después de la
temporada alta y con el runbook completo. Para entonces Vaquero Hub va a
llevar tres meses operando de verdad en una tienda, que es muchísimo mejor
punto de partida que el plan original.

Y la regla de la sección 37 del plan maestro sigue mandando: **correctitud
antes que velocidad.** La fecha es dura, pero si en la semana 5 el POS no
está sólido, se usa el plan de respaldo. No se abre una tienda con una
caja que no cuadra.
