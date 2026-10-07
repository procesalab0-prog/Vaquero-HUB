# Categorías de borradores guardados — 6 de octubre de 2026

Se verificaron internamente **1,229 vínculos nuevos** de categorías en staging,
conservando las nueve verificaciones existentes. Total: **1,238 bindings válidos**.
La segunda aplicación devuelve 1,229 UNCHANGED, sin nueva auditoría.
Esto acredita categorías en la captura; no aprueba contenidos ni publicación.

## Protección del contenido

`app.verify_saved_draft_categories` es administrativa, SECURITY INVOKER, privada
y limitada por el control STAGING. No tiene RPC pública ni permisos para anon,
authenticated o service_role. No cambia el preparador original, que sigue
rechazando borradores existentes con HUMAN_DRAFT_REVIEW_REQUIRED.

Bloquea producto, fuente, borrador y vínculo Woo. Exige igualdad exacta de:
ID Woo, hash de fuente, huella del snapshot, revisión y huella del borrador,
categorías literales y huella del catálogo. Rechaza categorías humanas distintas
de la sugerencia original, captura con más de 24 horas o fecha futura y cualquier
binding existente distinto/invalidado. Restaurar categorías no lo reactiva.

No normaliza ni reescribe categorías del editor. `category_paths` conserva su
representación literal, incluso CSV; `mappings` contiene por separado los IDs y
rutas completas comprobados. El orden de IDs no determina identidad. Las nueve
vinculaciones anteriores se conservaron sin modificación, incluido el amartigón.
Su regla de sólo exhibición sigue vigente.

La evidencia técnica se registra como TECHNICAL_CAPTURE_COMPARISON,
commercial_approval=false y send_allowed=false. No se fabrican revisores humanos
ni se activan permisos de envío. Las familias incompletas permanecen incompletas.
Antes de un envío futuro se debe renovar la evidencia remota correspondiente;
la vigencia de categorías no renueva precios, fotos o variantes históricas.

## Reproducción

Desde work/m9-ui, usando carpetas nuevas:

```sh
node scripts/m9/prepare-saved-category-review.mjs \
  ../../outputs/m9-categorias-catalogo-2026-10-06-v2 \
  ../../outputs/m9-taxonomia-catalogo-2026-10-06 \
  ../../outputs/m9-preparacion-bindings-2026-10-06/staging.json \
  ../../outputs/NUEVO_PAQUETE
```

El generador verifica los hashes de propuesta y captura, vuelve a calcular
pertenencia mediante el comparador conservador y cruza las fuentes staging.
Genera revisión, resumen, hashes y SQL en lotes de 50. Sólo invoca el procedimiento
protegido; no altera borradores, catálogo, existencias ni Woo. El JSON de revisión
no es una autorización comercial. La captura usada fue expresamente autorizada
por el usuario para GET de los 1,240 IDs públicos.

Evidencia vigente: outputs/m9-categorias-borradores-protegidos-2026-10-06-v2/.
La carpeta sin v2 es diagnóstica: reservaba por orden el mismo conjunto de
categorías del amartigón. La repetición v2 reproduce exactamente 28 archivos.
Dos reservas: Woo23718 sin fuente editorial y Woo33002 no devuelto públicamente;
ninguno se elimina ni se publica automáticamente.

## Verificación alojada

- 25 comprobaciones SQL ejecutadas y revertidas: contenido/fuente/catálogo
  cambiados, edición humana, capturas vencidas/futuras, IDs inválidos/duplicados,
  permisos, entorno, borrador ausente, idempotencia, invalidación y conservación.
- 1,229 VERIFIED al aplicar y 1,229 UNCHANGED al repetir los 25 lotes.
- Huellas globales de fuentes, borradores, catálogo y nueve bindings anteriores
  idénticas antes/después. 6,064 filas de catálogo, cero saldos/movimientos.
- Colas remotas/locales sin nuevas tareas. Sin modificación Woo ni producción.
- Advisor sin hallazgos para la función nueva; continúan avisos históricos de
  funciones autenticadas y protección de contraseñas. RLS cerrado de tablas
  internas conserva el aviso informativo sin políticas.

Migración local creada con CLI: 20261006224813_m9_saved_draft_category_review.sql.
Registro remoto staging: 20261006225005. No se renombró historia anterior.
No hay despliegue frontend ni nueva versión de la aplicación en esta entrega.
La cobertura SICAR sigue 6,064/16,224 (37.4% del catálogo).
