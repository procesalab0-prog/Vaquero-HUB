# Renovar Woo sin sobrescribir el catálogo migrado

Actualización posterior: ya se obtuvo el corte autenticado del 6 de octubre.
Ver [corte actual y ampliación de staging](M9_CORTE_WOO_ACTUAL_2026_10_06.md).
El ensayo y el bloqueo de acceso descritos abajo corresponden a la entrega
anterior, conservada como evidencia histórica.

La tienda sigue vendiendo y sus exportaciones tendrán que repetirse. El nuevo
`scripts/m9/prepare-woo-refresh.mjs` compara dos cortes completos autenticados
de Woo y señala qué vínculos del catálogo de staging pueden verse afectados.
No escribe, no importa, no descarga fotos y no genera SQL ni payload de envío.

## Comparación y protecciones

Compara todos los IDs de padres y variaciones, conservando identidad por ID,
sin empatar nombres ni SKU. Detecta cambios de texto, nombre, fotos, código
base/descripcion corta, categorías, atributos, precios/promociones, estado,
estructura y columnas adicionales del CSV. Los cambios de inventario se
contabilizan aparte, sin incluir sus valores en el reporte.

Un ID trasladado a otro padre, o que cambia entre padre y variante, queda en
revisión explícita. Una ausencia nunca autoriza borrado; una variación nueva
nunca recibe un código SICAR inventado. Los cambios Woo no reemplazan precio1,
departamento, sección, Clave 1 ni atributos de SICAR. Una ficha que requiere
renovación debe contrastarse con la fuente y con su borrador vigente antes de
actualizarla; este comparador no concede esa autorización.

Exige CSV autenticado completo, conteo de padres observado en el panel, conteo
total de registros, huella del CSV, IDs globalmente únicos y estados conocidos.
No acepta una captura pública como equivalente a una exportación autenticada.
Rechaza proyecto incorrecto, inventario, catálogo distinto de su fila aplicada
o del reporte SICAR de referencia, y vínculos staging ausentes de ambos cortes.
El reporte SICAR utilizado es la **referencia aplicada que acredita el estado
capturado de staging**, no una instrucción para sobrescribirlo con el corte nuevo.
Después se vuelve a conciliar la exportación nueva con SICAR completo.

Toda entrada se fija por SHA256 y se verifica antes de crear el directorio de
salida. La salida conserva UUIDs y huella de cada fila protegida. Los cambios
de campos CSV se revisan aunque no se reflejen en los campos normalizados;
columnas desconocidas no se ignoran. Reordenar variaciones por ID o cambiar el
número de línea CSV no crea un cambio de producto.

## Ensayo real histórico del 6 de octubre

Evidencia `outputs/m9-renovacion-woo-2026-10-06/`:

- Exportación inicial: 2,092 padres / 14,063 registros.
- Exportación del 1 de octubre: 2,119 padres / 14,258 registros.
- Comparación: 1,897 padres sin cambios, 121 con cambios para revisión,
  74 con cambios únicamente de inventario y 27 nuevos. Cero IDs trasladados.
- Cruce histórico: 118 padres / 813 códigos presentes en la captura staging
  están relacionados con esas diferencias entre exportaciones.

**No son 813 productos desactualizados ni cambios nuevos observados hoy.**
Staging ya coincide con su corte SICAR6 aplicado y utiliza el Woo del 1 de
octubre. Esta ejecución acredita que la herramienta detecta cambios entre
dos fuentes históricas reales, no que haya obtenido el catálogo Woo actual.

Las corridas definitivas `corrida-3` y `corrida-4` son idénticas en sus seis
archivos. Corridas 1–2 conservan evidencia intermedia. Los archivos son:
`comparacion-woo.json`, `resumen.json`, `impacto-staging.json`,
`identidades-movidas.json`, `resumen.txt` y `sha256.json`.

Se repitió además el preparador anterior con el snapshot verificado de 7,666
variantes: **22 candidatas pendientes, 0 preparadas, 7 padres reservados** por
sus controles de base/nombre. `preflight-1` y `preflight-2` son idénticos. No se
relajaron controles para cargar esas filas ni se eliminaron las reservas por
secciones, clasificación, duplicados o casos de dueños. La revisión de las 190
coincidencias exactas pendientes no autorizó nuevas cargas.

## Uso con una exportación nueva

1. Exportar todos los productos/variaciones de Woo desde una sesión autenticada,
   conservando originales y conteo del panel. El adaptador existente
   `work/m9/scripts/m9/woo_csv.py` prepara el snapshot; no fue duplicado ni cambiado.
2. Capturar staging y conservar su reporte SICAR aplicado de referencia.
3. Fijar rutas y SHA256 en `config.inputs`: `previous`, `current`, `rows`,
   `snapshot`. Usar `evidence_scope=RECEIVED_EXPORT_COMPARISON` para archivos
   realmente recibidos; `HISTORICAL_REHEARSAL` para un ensayo como el anterior.
4. Ejecutar dos veces a directorios nuevos y verificar reproducción:

   ```text
   node scripts/m9/prepare-woo-refresh.mjs CONFIG.json NUEVA_SALIDA
   ```

5. Reconciliar nuevamente todo SICAR y Woo. Revisar identidad, fuente y ediciones
   humanas del borrador antes de preparar un plan vigente de staging. Mantener
   pendientes las agrupaciones sólo SICAR y los demás casos ambiguos.

La sesión real de WordPress en Chrome está cerrada y pide comprobación humana.
Se solicitó al usuario entrar para descargar una exportación nueva; no se
resolvió la comprobación ni se usaron contraseñas por herramientas. La pestaña
queda abierta para ese paso. Ninguna nueva exportación se obtuvo en esta entrega.

## Verificación y estado

426 pruebas unitarias / 60 archivos aprobados; lint dirigido aprobado. Once
pruebas nuevas cubren inventario excluido, promociones, fotos/texto/categorías,
altas/ausencias sin borrar, traslados/cambios de rol, estados privados, columnas
CSV adicionales, vínculos staging inválidos, fuentes completas, orden,
reproducción y rechazo de alteración/salida existente.

Catálogo: **7,666 / 16,224 = 47.3%**, sin nuevas variantes en este bloque.
Sin cambios de base, inventario, Woo, permisos, colas, despliegue, producción o
merge. El siguiente avance de carga depende de renovar fuentes y/o resolver
los expedientes retenidos; la herramienta permite repetir cortes sin volver
a construir manualmente esta comparación. Sol sigue siendo suficiente;
Astra para pedidos, devoluciones, inventario central o auditoría final operativa.
