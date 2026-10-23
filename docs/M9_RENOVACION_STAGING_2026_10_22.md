# Renovación SICAR y padrón en staging · 22 de octubre de 2026

Este bloque continúa Preview 0.92. Sólo proyecto `zsezjtswqeijboezvado` y rama `codex/m9-staging-review`. No habilita producción, main, cobros, existencias ni otra campaña Woo. El usuario aplazó el acceso de Chrome: la renovación autenticada completa de Woo queda pendiente, sin volver a solicitarla en este bloque.

## Catálogo: siete descripciones conservadas

Aplicadas las siete parejas literales de 18221–18227, sólo en `public.m9_variant_details.source_description` y `app.m9_rows.source_row.description`. Permanecen exactos Clave 1, UUID, nombres nativos, precio, costo, taxonomía, agrupación individual, fuente original, imported_at y contexto Woo. La evidencia nueva se añade al diario privado inmutable; no sustituye la procedencia original.

Plan y contrato: [M9_REFRESCO_DESCRIPCIONES_SIETE_2026_10_22.md](M9_REFRESCO_DESCRIPCIONES_SIETE_2026_10_22.md). Preparaciones reproducidas y revisión independiente. QA local: 27 pruebas, 39 controles SQL y dos carreras reales con liberación de barreras parciales, sin deadlocks. Ensayo remoto APPLY/replay/REVERSE/replay y ROLLBACK: **179 tablas idénticas**. Después del commit, sólo cambian las dos tablas de descripción, el nuevo diario (+1) y auditoría (+1).

No se agruparon modelos ni se interpretaron sufijos. 11777, 13659, 7047 y 7522 siguen retenidos en esta renovación. No se redondearon precios. Los 435 códigos todavía sin catálogo activo permanecen separados. Presencia del corte: **15,961 de 16,396 códigos = 97.35%**; no es porcentaje global de migración ni de inventario confirmado.

## Padrón general renovado sin apertura

Se recorrieron las **172 cuentas con UUID único**, mediante recarga y lectura explícita de saldo, No pagado/Todos. Captura del 22 de octubre, **20:53:18.612–21:38:53.164 hora de México** (23 octubre 02:53:18.612–03:38:53.164 UTC). Es un intervalo, no cierre simultáneo. No incluye eliminados ni todo el historial pagado.

Resultado: 60 cuentas con saldo observado, **84 documentos**, $242,958 observados. Se conserva el archivo anterior de 171 cuentas y $250,128. Una cuenta nueva; ninguna identidad ausente ni renombrada. Dos cuentas cambian saldo y documentos; esos cambios y los dos nombres repetidos quedan en revisión. Un cero explícito observado no acredita liquidación, cancelación, abono ni entrega. La diferencia de −$7,170 no se contabiliza como pago.

Hay **114 identidades ya conservadas en el registro de origen y 58 adicionales**, distinto de las **171 identidades presentes en el censo anterior**. El flag histórico de 61 de aquel corte no se reescribe. Se reutiliza el archivador existente con un protocolo privado de renovación y contexto completo de registro/fuentes/prior, guard de ADMIN y staging, fechas y deltas validados, replay exacto y barreras NOWAIT. Definición v1 instalada preservada salvo despacho, incluyendo su reparación anterior de alias.

Dos preparaciones de cinco archivos y dos paquetes de tres archivos idénticos. Payload SHA256 `083b6c2903f3b7978d616b07e138c19a266125b97c89f6a8e8438b47dc367b0f`; plan `f55b75c43f6c06ae258b7b14316abeacfab11ab0a4cb91a17d661a48c4e795e4`. Revisión independiente desde las cuatro preimágenes privadas, 23 pins verificados. Ensayo remoto + replay + ROLLBACK: **179 tablas idénticas**. Commit sólo añade una fila a `app.m9_customer_census_archives` (1→2); ninguna fuente, registro, apertura, libro, caja o inventario cambia.

Auth real en Preview confirmó 172/84/114/58, fechas nuevas, $242,958 histórico y cero ventanas de cobro vigentes. El detalle separado de créditos conserva sus 60 cuentas, 84 documentos, 183 líneas, 95 abonos históricos y su hora del mediodía; el censo nuevo no lo renueva ni acredita entregas.

Contrato y QA: [M9_RENOVACION_PADRON_GENERAL_2026_10_22.md](M9_RENOVACION_PADRON_GENERAL_2026_10_22.md). QA PostgreSQL local: 40 rechazos de contenido y 9 de ACL; 168 tablas idénticas tras rollback, v1/replay/deriva/contención verificados. Regresión MXN admite el token explícito al final de textContent y sigue rechazando USD/moneda ambigua.

## Estado operativo y evidencia

Siguen sin declarar las **36 cantidades físicas de 12 códigos** y las **183 entregas**. El registro de origen permanece en 114; libro nativo de crédito en 0 filas. Las aperturas sintéticas anteriores de staging ($11,910) no se incrementaron. Cinco ensayos Woo congelados, trabajador/captura/stock/finanzas apagados. Ningún pago de pasarela acreditado por este bloque.

QA raíz: **1,912 pruebas unitarias en 151 archivos**, lint y build correctos. Auth real prueba el lector existente del corte nuevo; no significa aceptación operativa. Seguridad: WARN 134 SECURITY DEFINER públicos y uno de protección de contraseñas, sin nuevos WARN. INFO RLS sin policy 122→123 por el diario privado cerrado a clientes; no se ampliaron grants.

DDL remoto: `20261023033246 m9_sicar_description_refresh_seven` y `20261023033502 m9_general_census_renewal`. Archivos CLI locales: `20261023033110` y `20261023033245`, respectivamente; versiones distintas documentadas, contenido SQL exacto. No usar db push para repetir DDL ya aplicado.

Expediente privado: `outputs/m9-renovacion-staging-2026-10-22/`, con ensayos/commits, auditorías completas, controles, contratos, QA, manifest y verificador offline. Capturas de clientes y payloads permanecen fuera de Git, carpetas 700/archivos 600.

Siguiente: renovar Woo completo cuando Chrome esté disponible; confirmar físico y mercancía comprometida del piloto; revisar las dos diferencias documentales con detalle vigente antes de cualquier apertura. La prueba completa de pasarela sigue aparte. El arranque permanece por etapas y sólo con evidencias confirmadas.


### Aceptación del Preview de renovación

Commit publicado `b4a77a08b64f2b236ff14191a4d29b7adc67bef1`, árbol probado `713796bf6db319d1761cd7c100fd55820d0dd495`, sólo `codex/m9-staging-review`. Despliegue SUCCESS: https://vercel.com/procesa-lab/vaquero-hub/CpqPxkNNqbt49uxEXfJ8yuVzbbef . La versión de aplicación sigue en 0.92.0; no se anuncia una versión distinta por este bloque.

Auth ADMIN real comprobó el padrón 172/84/114/58 y los dos casos con diferencia: aumento documental y cero observado, ambos retenidos sin atribuir abonos ni entregas. Las etiquetas distinguen registro de origen de pertenencia al censo anterior; nombres duplicados y diferencias financieras ya no comparten un aviso engañoso. Auditoría de las 179 tablas sin diferencias después de las consultas; fila anterior del archivo exacta y payload nuevo íntegro.

Expediente privado reproducible: `outputs/m9-renovacion-staging-2026-10-22/reporte.html`, `manifest.json` y `verificar.mjs`. Se conservan capturas, recibos, auditorías, revisiones, pares reproducidos y snapshots del código publicado. QA local detenido al cerrar; fuentes e historia conservadas. Sin main, Woo real, producción ni activación operativa.
