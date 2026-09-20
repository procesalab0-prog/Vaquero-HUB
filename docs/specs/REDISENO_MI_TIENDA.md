# Rediseño de Mi Tienda SM basado en Mi Vaquero SM

## Decisión

La versión terminada de la PWA **Mi Vaquero SM** es la referencia visual para
el rediseño de **Mi Tienda SM**. Ambas aplicaciones deben reconocerse como un
mismo ecosistema, sin confundir la experiencia del cliente con la operación
interna de la tienda.

La referencia revisada incluye:

- paleta corporativa negra, blanca, hueso, café y arena;
- tipografía editorial para títulos y PT Sans para interfaz;
- navegación sobria, superficies limpias y alto contraste;
- movimiento discreto, respetando `prefers-reduced-motion`;
- diseño responsive y zonas seguras de la PWA;
- identidad Vaquero SM sin inventar reglas de lealtad.

El **MANUAL DE IDENTIDAD VSM**, edición mayo de 2025, sigue siendo el documento
rector: el logotipo no se deforma, se conserva su área de respeto y no se
introducen colores, efectos o composiciones incompatibles con la marca.

## Adaptación para el sistema interno

Mi Tienda SM no copiará las pantallas de cliente. Reutiliza el lenguaje visual
y lo adapta a una aplicación operativa que necesita mayor densidad, rapidez y
claridad:

- permisos, sucursal, caja y estados críticos permanecen visibles;
- POS, inventario, caja y conteos conservan teclado, lector y operación táctil;
- tablas y formularios no pierden información para parecer más decorativos;
- confirmaciones se reservan para consecuencias importantes;
- teléfono vertical, iPad y computadora deben seguir siendo completamente
  utilizables;
- impresión de tickets y etiquetas conserva sus medidas y alto contraste, sin
  heredar el tema de pantalla.

El rediseño no puede modificar reglas de negocio, permisos, auditoría,
cálculos de dinero ni movimientos de inventario.

## Implementación incremental

La primera entrega se implementó como una capa de sistema visual compartido:

1. tokens corporativos de color, radios, bordes y sombras;
2. PT Sans para interfaz y Cormorant como respaldo editorial autorizado
   mientras se resuelve la licencia digital de Minion Pro Display;
3. acceso con composición editorial de la PWA;
4. navegación negra, estado activo hueso y jerarquía tipográfica compartida;
5. botones, tarjetas, métricas, tablas y acciones rápidas con la nueva voz;
6. adaptación responsive sin tocar la lógica de los módulos.

Las siguientes entregas migrarán por módulo. POS, Productos, Inventario, Caja
y Devoluciones requieren comparación antes/después con usuarios reales antes
de retirar definitivamente su presentación anterior.

## Criterios de aceptación

- No existe pérdida funcional ni debilitamiento de permisos o auditoría.
- Las tareas frecuentes requieren los mismos pasos o menos.
- Texto, contraste y objetivos táctiles son legibles para el personal.
- No hay controles encimados ni contenido inaccesible en 390 × 844,
  768 × 1024, 1024 × 1366 y escritorio.
- No se agregan videos ni animaciones que retrasen cobro, conteo o recepción.
- El rendimiento no empeora de forma perceptible.
- Cada módulo migrado conserva pruebas funcionales y una comprobación visual.

