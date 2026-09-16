# Handoffs para GPT-6 Astra

> Guardado el 16 de septiembre de 2026 para reutilizar tareas complejas sin
> copiar el historial completo del chat.

## Configuración común

- Abrir una tarea nueva dentro del proyecto **Vaquero-HUB**.
- Empezar desde `main` en un **worktree aislado**.
- Modelo: **GPT-6 Astra**.
- Razonamiento inicial: **medio**. Subir a alto sólo cuando la conciliación,
  la arquitectura o una decisión transversal lo justifiquen.
- El repositorio es la fuente de verdad. No usar una conversación anterior
  como sustituto de `AGENTS.md`, `CLAUDE.md` y los documentos maestros.
- No trabajar SICAR, WooCommerce y rediseño en una sola entrega.
- Cada bloque termina con pruebas proporcionales al riesgo, PR revisable y CI
  verde antes de fusionar.

## Prompt para SICAR

> Trabaja en Vaquero HUB / Mi Tienda SM usando GPT-6 Astra. Lee completamente
> `AGENTS.md`, `CLAUDE.md`, `PROJECT_CONTEXT.md`,
> `docs/PLAN_MAESTRO_VAQUERO_HUB.md`,
> `docs/ESTADO_Y_CONTINUIDAD.md`, `docs/PENDIENTES.md`,
> `docs/COLA_DE_TRABAJO.md` y toda la especificación de M9 antes de
> modificar código.
>
> Continúa desde `main` en un worktree aislado. Tu objetivo es completar
> primero la migración y conciliación de SICAR siguiendo las compuertas de
> seguridad existentes: análisis, corrida en seco, staging, conciliación y
> autorización explícita antes de producción. No habilites inventario ni
> producción automáticamente. Conserva los identificadores propios de Mi
> Tienda SM, la auditoría y la idempotencia. Ejecuta pruebas significativas,
> abre un PR y no fusiones hasta que CI esté verde.
>
> WooCommerce se trabajará después como una fase separada. No mezcles ambos
> procesos en la misma entrega.

## WooCommerce

Se abrirá otra tarea únicamente cuando SICAR tenga una conciliación aprobada.
El prompt deberá partir de los resultados y mapeos documentados por M9, separar
catálogo, inventario, precios, pedidos y clientes, y definir para cada dato cuál
sistema es la fuente de verdad antes de permitir escrituras.

## Prompt para auditoría de experiencia y rediseño

Usar este prompt después del piloto, cuando los recorridos operativos ya sean
estables. La auditoría y la implementación son dos entregas distintas.

> Audita la experiencia completa de Mi Tienda SM con GPT-6 Astra. Lee
> `AGENTS.md`, `CLAUDE.md`, `PROJECT_CONTEXT.md`,
> `docs/PLAN_MAESTRO_VAQUERO_HUB.md`,
> `docs/ESTADO_Y_CONTINUIDAD.md` y las reglas de ergonomía antes de actuar.
> Trabaja desde `main` en un worktree aislado.
>
> En esta primera entrega no rediseñes ni modifiques código funcional. Recorre
> los flujos reales en teléfono vertical, iPad táctil y computadora: inicio de
> sesión, cambio de sucursal, venta, carrito, cobro, caja, productos,
> inventario, conteos, traspasos, clientes, devoluciones, apartados, crédito,
> compras, reportes, cotizaciones y tickets. Revisa pasos, toques, tiempo,
> scroll de modales, solapamientos, jerarquía visual, estados vacíos, mensajes,
> accesibilidad, contraste, tamaños táctiles, teclado, rendimiento y
> consistencia.
>
> Compara la interfaz con el brief y con el principio “el sistema debe
> adaptarse al humano”. Entrega evidencia por dispositivo, hallazgos
> priorizados por impacto y frecuencia, recorridos antes/después y una
> propuesta visual coherente. Distingue correcciones ergonómicas, refresco
> visual y rediseño estructural. Conserva las reglas de negocio, permisos,
> auditoría, impresión y seguridad.
>
> No implementes el rediseño hasta que el informe sea aprobado. Después crea
> una segunda tarea y un PR por bloques verificables, sin una sustitución total
> de la interfaz en un solo cambio.

## Criterio para elegir tarea nueva

- **SICAR:** tarea nueva; riesgo de identidad, inventario y conciliación.
- **WooCommerce:** tarea nueva posterior; integración con fuentes externas.
- **Auditoría de diseño:** tarea nueva y sólo lectura en su primera entrega.
- **Implementación del rediseño:** segunda tarea, después de aprobar la
  auditoría.
