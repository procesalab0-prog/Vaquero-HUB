# Pendientes: responsables y bloqueos

> Complementa la cola de implementación de
> [`COLA_DE_TRABAJO.md`](COLA_DE_TRABAJO.md). Aquí viven las tareas de los
> entornos alojados, decisiones del dueño y riesgos de proceso.
>
> Última actualización: 2026-09-02.

## Supabase: estado verificado

Las correcciones de M2 se aplicaron primero en staging y después en
producción:

- `20260902150000_m2_candado_de_combinacion.sql` serializa por producto la
  comprobación de talla/color para evitar duplicados concurrentes.
- `20260902170000_m2_prefijo_interno_reservado.sql` impide registrar como
  MANUAL o SUPPLIER un EAN-13 que comience con `20`–`29`.

Staging también recibió las tres migraciones de M2 que tenía pendientes:
combinaciones únicas, agregado de variantes y registro de códigos externos.

Las consultas posteriores devolvieron cero hallazgos en ambos entornos para:

- combinaciones de atributos duplicadas;
- `legacy_sicar_code` escrito antes de la importación;
- códigos con origen `SICAR` antes de la importación;
- códigos EAN-13 externos dentro del rango `20`–`29`.

También se verificó que ambos entornos contienen el candado y el rechazo
`RESERVED_INTERNAL_PREFIX`, y que `anon` y `authenticated` no pueden invocar
directamente el disparador interno. En producción se probó el rechazo del
prefijo dentro de una transacción revertida.

La carga masiva 0.17.0 y sus dos migraciones correctivas se aplicaron primero
en staging y después en producción. En ambos entornos `anon` no puede ejecutar
la validación ni la confirmación; `authenticated` sólo entra a funciones que
vuelven a exigir `products.create`. La publicación real en Vercel quedó
verificada el 2 de septiembre de 2026.

## Compuerta pendiente de SICAR

No se debe habilitar la generación de códigos para operación real hasta
revisar una exportación de muestra de SICAR y demostrar que ningún código
heredado de trece dígitos comienza con `20`–`29`.

La base de producción contiene 18 códigos `GENERATED` creados durante el
desarrollo. No son códigos externos ni se modificaron en esta corrección. Se
deben identificar como pruebas o mercancía real cuando llegue la exportación;
los códigos generados son inmutables y no se borran por suposición.

## Decisión del dueño: quién registra códigos de proveedor

`register_variant_barcode` exige actualmente `products.update`, permiso de
ADMIN y MANAGER. El rol de almacén recibe mercancía pero no tiene ese permiso.
No ampliar privilegios sin una decisión explícita.

Opciones:

1. Dar `products.update` a almacén, con el costo de permitir también editar
   producto y categoría.
2. Crear `products.barcode_register`, limitado a la tarea real. Esta es la
   opción técnica de menor privilegio, pero sigue necesitando aprobación del
   dueño.

## Orden inmediato de implementación

1. El lector de cámara quedó construido en 0.15.0. Probarlo dentro de la PWA
   instalada y validar un código generado tanto en pantalla como impreso con
   iPhone y Android reales.
2. La edición segura de producto y variante quedó terminada en 0.16.0: separa
   datos generales, costo/estado y precio por permiso, y no acepta SKU,
   códigos ni campos de SICAR/WooCommerce.
3. La carga masiva propia quedó terminada en 0.17.0: plantilla CSV/XLSX,
   corrida en seco y confirmación atómica. No importa SICAR ni WooCommerce.
4. **Siguiente:** M2.5, plantillas y etiquetas desde computadora de
   trastienda.
5. Después de cerrar M2 y la prueba física: M3, inventario, movimientos y
   traspasos.

La validación física necesita dispositivos y una impresión real; las pruebas
automatizadas no la sustituyen.

## Regla de proceso

Una migración que ya entró a `main` nunca se corrige editando su archivo. Se
crea otra migración con el estado final deseado, se prueba en staging y luego
se aplica a producción. CI reconstruye bases vacías y no detecta por sí solo
la divergencia de una base que ya registró la migración anterior.

No fusionar ramas de revisión antiguas completas sobre `main`: comparar sus
archivos e integrar sólo el trabajo faltante evita perder cambios más nuevos.

Las revisiones deben cerrarse mediante PR o dejar enlazado el commit exacto que
integró su contenido. Copiar archivos a `main` y dejar el PR abierto vuelve
indistinguible el trabajo aplicado del trabajo todavía pendiente. Este riesgo ya
costó recuperar la prueba de cámara y reescribir la corrección del candado de
combinaciones.

## Riesgo de calendario y conexión real

La estimación al cerrar la carga masiva queda alrededor del 35 % del alcance
de octubre. M0, M1 y M1B están terminados; M2 continúa en curso; M3, M4 y M5
tienen especificación pero no implementación operativa completa; M9 sigue
bloqueado por la muestra de SICAR.

Existen once pantallas visuales, pero sólo Productos, Clientes y Administración
están conectadas a la base. POS, Caja, Inventario, Tickets, Etiquetas y Ajustes
todavía contienen partes simuladas. El calendario completo y la estrategia para
la segunda sucursal viven en [`PLAN_OCTUBRE.md`](PLAN_OCTUBRE.md).

## Asuntos todavía bloqueados

- Exportación de muestra de SICAR y simbología que usa actualmente.
- Escalas de talla de sombreros, texanas y cinturones.
- Reglas de puntos, crédito y apartados.
- Forma definitiva de envío de tickets por SMS o correo.
- Método de costo de compra.
- Decisión sobre el permiso para registrar códigos de proveedor.

Las preguntas completas viven en
[`PREGUNTAS_CLIENTE.md`](PREGUNTAS_CLIENTE.md).
