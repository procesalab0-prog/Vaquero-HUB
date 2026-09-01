# Reparto del trabajo entre dos cuentas

> # ⛔ EN ESPERA — NO ARRANCAR
>
> **Este reparto está escrito pero no autorizado.** Nadie empieza a
> trabajar bajo este esquema, ni se da de alta la segunda cuenta, ni se
> reparten tareas, hasta que ProcesaLab lo indique explícitamente.
>
> Mientras tanto el trabajo sigue como está: una sola cuenta, un
> milestone a la vez, según `PLAN_CODEX.md`.
>
> Cuando se autorice, se quita este bloque y se anota aquí la fecha.

Fecha de redacción: 2026-09-01.

---

## 1. El criterio del reparto

La idea original era mandar «lo más fácil» a la cuenta nueva. El criterio
que conviene usar es otro, aunque en la mayoría de los casos coincide:
**se reparte por acoplamiento, no por dificultad.**

Los dos no siempre van juntos:

- La interfaz del POS **se ve difícil** y en realidad está bien aislada:
  habla con el backend por una sola llamada.
- El cambio de precio en lote **se ve fácil** y toca permisos, bitácora y
  dinero al mismo tiempo.

Lo que se manda a la cuenta nueva es lo **desacoplado**. Cuando dificultad
y aislamiento se contradicen, gana el aislamiento.

## 2. El núcleo que no se reparte

Estas piezas tienen **un solo dueño** — la cuenta principal — y nadie más
las toca. Son donde un error se paga carísimo y donde dos manos son peor
que una:

- `app.apply_movement` y toda la lógica de movimientos de inventario.
- `create_sale` y el reparto de pagos, descuentos y redondeos.
- Las funciones auxiliares de RLS y todas las políticas.
- La asignación de folios y el mecanismo de idempotencia.
- La máquina de estados de traspasos, en la parte que escribe movimientos.

**Regla adicional, y es la que más fricción evita: la carpeta
`supabase/migrations/` tiene un solo dueño.** Todo cambio de esquema sale
de la cuenta principal. Si la cuenta nueva necesita una columna, la pide;
no la crea. Es un límite fácil de verificar y elimina de golpe la peor
clase de conflicto.

## 3. Lo que sí va a la cuenta nueva

Ordenado por cuándo puede empezar.

### 3.1 Puede arrancar de inmediato, sin depender de nada

| Trabajo | De dónde sale | Por qué está aislado |
|---|---|---|
| **Etiquetas**: diseñador de plantillas e impresión masiva | M2 §6 | Tablas propias, sin dinero ni existencias de por medio |
| **Escaneo con cámara** | `ESCANEO.md` | Componente cerrado con una interfaz limpia; cero lógica de negocio |
| **Generador de variantes**: matriz talla × color editable | M2 §3 | Interfaz más una inserción simple |
| **Búsqueda de productos**: agrupada por producto padre, y el campo único del POS | M2 §7 | Sólo lectura |
| **Pantallas de administración**: empleados, roles, sucursales | M1 §10 | Consume permisos, no los define |

### 3.2 Arranca cuando exista el contrato de venta

| Trabajo | Depende de |
|---|---|
| **Interfaz del POS**: carrito, teclado numérico, prevención de doble toque, operación táctil | Que la cuenta principal publique la firma de `create_sale` |
| **Pantalla de cobro**: captura de pagos mixtos y su desglose | Lo mismo |

Es la pieza más grande de la cuenta nueva y está bloqueada hasta que el
contrato exista. Por eso conviene que la cuenta principal **defina y
publique la firma de `create_sale` antes que su implementación**: una
firma acordada desbloquea semanas de trabajo en paralelo.

### 3.3 Al final, si hay tiempo

| Trabajo | Nota |
|---|---|
| **Reportes básicos** de ventas y existencias | Vistas de sólo lectura; no puede romper nada |
| **Validador de la carga masiva** | La parte que **lee y reporta**. La que escribe se queda en la cuenta principal |

## 4. Lo que se queda, aunque parezca fácil

| Trabajo | Por qué no se reparte |
|---|---|
| Cambio de precio en lote | Toca permisos, bitácora y dinero a la vez |
| Ajustes de inventario | Escribe movimientos |
| Apertura y cierre de caja, cortes | Cuadre de dinero |
| Devoluciones y cambios (M5) | Escribe movimientos inversos sobre ventas existentes |
| Importador y sincronizador (M9) | Escribe catálogo e inventario masivamente |

## 5. Reglas de convivencia

1. **Ramas:** `codex/...` para la cuenta principal, `codex2/...` para la
   nueva. Nunca las dos sobre la misma rama.
2. **Un PR no cruza la frontera.** Si un cambio necesita tocar el núcleo
   de la sección 2, se parte en dos PRs con dueños distintos.
3. **Las specs de `docs/specs/` son el contrato.** Con dos personas y dos
   IAs distintas, son lo único que evita que se construyan dos sistemas
   diferentes. Si una spec está mal, se corrige en un PR propio antes de
   implementar contra ella — no se interpreta sobre la marcha.
4. **Claude revisa los dos lados.** Especialmente las costuras: donde la
   interfaz de una cuenta llama a la lógica de la otra.
5. **Nada se despliega a producción** sin autorización explícita de
   ProcesaLab, venga de la cuenta que venga.

## 6. Antes de activar este reparto

Cuando se autorice, estas cosas tienen que estar listas o el reparto va a
generar más fricción de la que ahorra:

- [ ] Firma de `create_sale` definida y publicada (desbloquea la 3.2).
- [ ] Correcciones de los issues #3, #4, #5 y #6 aplicadas, para que las
      dos cuentas partan de specs correctas.
- [ ] Accesos de la segunda cuenta al repositorio y a Supabase local.
- [ ] Reglas de la sección 5 acordadas con ambas personas.
- [ ] Este bloque de espera retirado, con la fecha de autorización
      anotada arriba.
