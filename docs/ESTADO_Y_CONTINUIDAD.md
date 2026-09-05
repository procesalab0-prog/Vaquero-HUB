# Estado del proyecto y cómo continuarlo

> Punto de entrada para cualquiera que retome este proyecto — persona o
> agente — sin haber estado en las conversaciones anteriores.
>
> **Los agentes no tienen memoria entre sesiones. Este repositorio es la
> memoria del proyecto.** Todo lo que haga falta para continuar tiene que
> estar aquí, no en un chat.
>
> Última actualización: 2026-09-02.

## 1. Qué es esto

Sistema de gestión para **Vaqueros SM**, una tienda de botas y ropa
vaquera en La Piedad, Michoacán, desarrollado por **ProcesaLab**.
Sustituye progresivamente a SICAR, el punto de venta que usan hoy, e
integra su tienda en línea de WooCommerce.

La aplicación se llama **Mi Tienda SM**; el proyecto, Vaquero Hub.

**Antes de tocar nada, leer en este orden:**

1. [`PLAN_MAESTRO_VAQUERO_HUB.md`](PLAN_MAESTRO_VAQUERO_HUB.md) — el
   negocio, las reglas y el alcance. Manda sobre todo lo demás.
2. [`PLAN_CODEX.md`](PLAN_CODEX.md) — cómo se implementa: decisiones
   técnicas cerradas, reglas innegociables, milestones.
3. [`PLAN_OCTUBRE.md`](PLAN_OCTUBRE.md) — el calendario vigente y por qué.
4. La especificación del milestone que toque, en [`specs/`](specs/).

**¿Listo para implementar?** La lista ordenada de qué sigue está en
[`COLA_DE_TRABAJO.md`](COLA_DE_TRABAJO.md): se toma de arriba hacia abajo,
saltando lo bloqueado.

## 2. Dónde vamos

### Terminado y en `main`

| Milestone                | Qué quedó                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| **M0**                   | Next.js, Supabase local, migraciones versionadas, Vitest, Playwright, CI                                 |
| **M1**                   | Sucursales, empleados, roles, permisos granulares, RLS, bitácora, PIN de supervisor                      |
| **M1B**                  | Clientes, número de socio con dígito verificador, tarjeta digital, acceso sin contraseña, PWA de cliente |
| **M2 (segunda entrega)** | Catálogo real, alta atómica, búsqueda, matriz color × talla e identidad automática protegida             |
| **M2 (revisión)**        | Una sola variante por combinación de atributos, protegida también ante concurrencia                      |
| **M2 (tercera entrega)** | Agregar tallas o colores a un producto sin cambiar identidades existentes                                |
| **M2 (cuarta entrega)**  | Códigos de proveedor y reimpresión seguros; los códigos anteriores siguen escaneando                     |
| **Calidad 0.14.0**       | Navegación con sesión deduplicada, carga inmediata y scroll verificado en teléfono, iPad y computadora   |
| **Corrección 0.14.1**    | Candado concurrente aplicado y prefijo interno 20–29 bloqueado para códigos externos                     |
| **Componente 0.15.0**    | Cámara en Productos, detección nativa/ZXing, búsqueda real y recuperación de permisos                    |
| **M2 (quinta entrega)**  | Edición segura de producto, costo/estado y precio con permisos separados e identidad inmutable           |
| **M2 (sexta entrega)**   | Carga masiva CSV/XLSX con validación en seco, confirmación atómica y códigos propios protegidos          |
| **M2.5 (0.18.0)**        | Selección y precios en lote auditados; plantillas persistentes e impresión real de etiquetas             |
| **M3.1 (0.19.0)**        | Saldos por sucursal, libro inmutable, ajustes auditados y pantalla de inventario con datos reales        |
| **M3 (0.20.0)**          | Conteos formales y traspasos con aprobación, tránsito explícito, recepción parcial y auditoría           |
| **M4 (0.22.0)**          | Ventas atómicas, pagos mixtos, cajas, corte ciego, tickets reales y cancelación segura                    |
| **M5 (primera entrega)** | Libro inmutable y cambio parejo con ticket, inventario atómico e idempotencia                             |

Cuarenta y ocho migraciones versionadas del repositorio. El proyecto de Supabase
existe en `us-east-1`, PostgreSQL 17, plan Pro.

### Entornos alojados

- **Producción:** Vercel Production usa la rama `main` de Supabase, proyecto
  `drubkjlmfbdeglucakmg`. Las correcciones de M2 fueron aplicadas y verificadas
  el 2 de septiembre de 2026; las cuatro consultas de contaminación devolvieron
  cero hallazgos. M2.5 0.18.0 también quedó aplicado, con ejecución anónima
  revocada. M3 0.20.0 se promovió después de CI verde; la comprobación directa
  posterior encontró cero descuadres entre libro y saldo, y Vercel confirmó la
  publicación del merge en `main`. M4 0.21.1 también quedó aplicado después de
  CI verde, incluidas las pruebas concurrentes de venta e idempotencia.
- **Pruebas:** la rama Supabase `staging`, referencia
  `zsezjtswqeijboezvado`, se reserva para Vercel Preview y validaciones previas
  a producción. M4 0.21.3 conserva esa validación, corrige la lectura segura
  del historial de traspasos y confirma por navegador el pago combinado.
  M4 0.21.1 se validó primero en este ambiente antes de
  promoverse; las migraciones de inventario siguieron el mismo recorrido.
  M2.5 conserva sus pruebas de escritura atómica, límites, permisos, cambio
  concurrente de precio y auditoría de 300 variantes. Sus cuatro consultas de
  contaminación también devolvieron cero hallazgos.
- Los dos entornos usan credenciales distintas. Las claves viven únicamente en
  variables protegidas de Vercel; nunca se copian al repositorio.
- La clave secreta de staging se rotó después de separar los ambientes. Las
  claves anteriores quedaron revocadas y sólo permanece activa la credencial
  identificada para Vercel Preview.
- Producción cuenta con la sucursal inicial `LAP` y accesos administrativos
  provisionados de forma segura para validar los flujos autenticados. Las
  credenciales nunca se documentan en el repositorio.

### Falta para el alcance de octubre

| Milestone                                        | Estado de la especificación                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **M2** — catálogo, variantes, códigos, etiquetas | **Terminado en software.** Sólo falta la validación física: imprimir una etiqueta real y escanearla, con cámara y lector |
| **M3** — inventario, movimientos, traspasos      | **Terminado en software:** saldos, libro inmutable, ajustes, conteos, traspasos y mercancía en tránsito                  |
| **M4** — POS, pagos mixtos, caja                 | **Terminado en software:** falta validar físicamente la operación táctil y la impresora elegida                          |
| **M5** — devoluciones, cambios, cancelaciones    | **En curso:** base y cambio parejo terminados; reembolsos y diferencias esperan reglas del negocio                      |
| **M9** — importador y sincronizador de SICAR     | Falta                                                                                                                    |

Recorridos a después de octubre: M6 compras, M7 apartados y lealtad, M8
reportes y cotizaciones.

**Con M3 y M4 cerrados y M5 iniciado queda menos de una semana de
construcción definida del alcance de octubre, además de SICAR, las decisiones
pendientes y el piloto físico.** El detalle, y las advertencias que impiden leer ese número
con optimismo, están en [`PENDIENTES.md`](PENDIENTES.md).

## 3. Por qué la fecha es octubre

**En octubre abre la segunda sucursal.** No es entusiasmo: es un evento de
negocio.

La decisión que hace que quepa: **la sucursal nueva abre operando en Mi
Tienda SM, y la sucursal 1 sigue en SICAR hasta enero.** La tienda nueva no
tiene operación que interrumpir, así que es el escenario de menor riesgo
del proyecto y llega solo. El detalle está en
[`PLAN_OCTUBRE.md`](PLAN_OCTUBRE.md).

El corte de la sucursal 1 va en **enero**, después de la temporada alta,
con el procedimiento de [`RUNBOOK_CORTE.md`](RUNBOOK_CORTE.md).

## 4. Lo que más frena hoy

**No es el código.** M0, M1 y M1B se construyeron en un día. Lo que puede
tumbar la fecha son cinco cosas que dependen del cliente y del hardware:

1. **Exportación de muestra de SICAR.** Sin ella, M2 se diseña adivinando
   cómo codifica tallas y colores, y M9 no se puede validar.
2. **Impresora térmica comprada y probada.** Si no imprime por red desde el
   navegador, cambia la arquitectura del POS. Ver `PLAN_CODEX.md` §9.1.
3. **Lector de códigos**, que debe ser imager 2D si la tarjeta de lealtad
   va a vivir en el teléfono.
4. **Respuestas de negocio.** Más de treinta preguntas sin contestar en
   [`PREGUNTAS_CLIENTE.md`](PREGUNTAS_CLIENTE.md), agrupadas por tema y
   marcadas por lo que bloquea cada una.
5. **Lista de empleados y cajas** de la sucursal nueva.

Si retomas el proyecto y sólo puedes empujar una cosa, empuja éstas antes
que el código.

## 5. Las reglas que no se negocian

Están completas en `PLAN_CODEX.md` §2. Las que más se rompen por descuido:

1. **El cliente nunca dice cuánto cuesta algo.** Los precios se leen de la
   base dentro de la transacción.
2. **Dinero en centavos enteros.** Jamás punto flotante.
3. **Ningún stock se mueve sin movimiento auditable.**
4. **Nada se borra:** ni ventas, ni movimientos, ni historial. Se compensa.
5. **RLS activo siempre**, y ninguna política se escribe sobre «está
   autenticado» a secas — eso no significa nada, porque los clientes
   también se autentican.
6. **Toda función `SECURITY DEFINER` que escriba valida permisos
   explícitamente**, porque por definición se saltó la RLS.
7. **Los códigos heredados de SICAR nunca se modifican.**
8. **Esquema sólo por migraciones versionadas**, nunca desde el panel.
9. **Una migración ya fusionada no se edita:** toda corrección usa otra
   migración y se prueba en staging antes de producción.

## 6. Cómo se trabaja

- Un milestone a la vez, en el orden M2 → M3 → M4 → M5 → M9.
- Rama por milestone, PR, revisión, y un humano aprueba el merge.
- Cada PR responde: qué se modificó, por qué, riesgos, pruebas,
  migraciones e impacto.
- Si una regla de negocio necesaria no está confirmada, **no se inventa**:
  se implementa lo que sí está definido y se deja lo demás fuera del PR,
  marcado como bloqueado.
- Si una especificación está mal, se corrige en un PR propio **antes** de
  implementar contra ella. No se interpreta sobre la marcha.

Cuando el trabajo se divida en dos cuentas, el reparto ya está escrito en
[`REPARTO_TRABAJO.md`](REPARTO_TRABAJO.md) — **en espera, no autorizado.**

## 7. Deudas conocidas

| Qué                                                                                  | Dónde              |
| ------------------------------------------------------------------------------------ | ------------------ |
| Si falla el borrado de Auth después de anonimizar, falta una cola de reintento       | Seguimiento de M1B |
| Mudanza de la PWA de clientes a subdominio propio                                    | Issue #8           |
| Las specs se escribieron sin contemplar la interfaz que ya existía                   | Issue #4           |
| El plan maestro no incluye el catálogo de los 19 requerimientos que pidió el cliente | Issue #3           |

Los nueve hallazgos de [`AUDITORIA_SPECS.md`](AUDITORIA_SPECS.md) ya están
resueltos; el documento se conserva porque explica **por qué** las
decisiones son como son, y evita que alguien las «arregle» de vuelta.

## 8. Un aviso sobre la auditoría

Tres de esos hallazgos eran del mismo tipo: **cosas que parecían proteger y
no protegían.** Un `revoke` que rompía consultas en vez de negarlas, un
contador de intentos que se revertía con la excepción que lo seguía, una
función que confiaba en el id de usuario que le pasaban por parámetro.

Conviene revisar con esa pregunta encima: _¿este control de verdad hace lo
que dice?_ Que exista el código no significa que funcione.
