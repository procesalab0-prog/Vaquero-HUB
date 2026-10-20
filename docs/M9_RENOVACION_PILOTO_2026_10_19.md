# M9 · Renovación de fuentes y primer piloto preparado

## Resultado y alcance

Se recibieron las exportaciones completas del 19 de octubre: SICAR del usuario
y Woo autenticado. Se conservaron los originales, se compararon con el corte
del 12 de octubre y se preparó un piloto de 12 códigos revisados, de 12 padres
Woo distintos. No se cargaron productos, saldos, reservas ni costos; no se
activaron ventas, sincronización o publicación. Producción y main intactos.

| Fuente | Corte anterior | Corte recibido | Diferencia |
| --- | ---: | ---: | --- |
| Códigos únicos SICAR | 16,310 | 16,381 | 71 nuevos, ninguno ausente |
| Padres Woo, sin papelera | 2,166 | 2,174 | 8 nuevos |
| Registros Woo incluidos hijos | 14,349 | 14,435 | 12,261 variaciones actuales |

Woo incluye 2,056 padres publicados, 96 borradores y 22 privados. Papelera
excluida; metadatos personalizados no exportados. No es un raspado público.
SICAR incluye todos los departamentos y categorías, precios con impuesto,
paquetes sin seleccionar y almacén **default**. No se ha confirmado que ese
almacén represente La Piedad ni todas las sucursales.

La carga previa permanece en 15,876 códigos. Con el denominador renovado,
la cobertura de catálogo es **15,876/16,381 = 96.92%**. Faltan 505 por cargar
(434 anteriores y 71 nuevos). No es porcentaje total de M9 ni pérdida de carga.
Las retenciones de venta ya existentes siguen separadas de esa cobertura.

## Comparación reproducible

El analizador y conciliador existentes se reutilizan sin modificar su criterio.
Dos corridas generan diez archivos idénticos por SHA256. Se conservan Clave 1
literal y sus ceros, sin duplicados de códigos en el corte nuevo.

SICAR presenta 29 cambios de datos de catálogo y 334 diferencias de existencia
en el diagnóstico bruto; pueden coincidir en una misma fila. No se atribuyen
a ventas ni se importan. El delta usado para clasificar filas separa 286 cambios
sólo de inventario, 181 sólo de conciliación, 16 de catálogo, 13 de precio
público y 71 nuevos; 15,814 quedan iguales. En staging, 28 filas existentes
tienen diferencias de datos de catálogo que requieren revisión antes de aplicar.

Woo: 1,914 padres iguales, 141 con cambios sólo de inventario, 111 con otros
cambios y 8 nuevos. No hay desplazamientos de IDs. Los cambios afectan como
referencia a 68 padres vinculados y 404 códigos ya cargados: no son 404 errores
ni preguntas nuevas, y no autorizan sobrescrituras.

`compareWooSources` se extrae del comparador existente para permitir esta
comparación offline con historial en staging. El aplicador anterior conserva
su precondición de libros vacíos y todos sus controles. No se falsean auditorías
ni se borra historial para ejecutar herramientas antiguas.

## Selección del piloto

`scripts/m9/prepare-renewed-pilot.mjs` recibe siete entradas fijadas por SHA256.
Usa la captura completa del bloque previo, revalidada contra la auditoría actual
idéntica de 18 tablas; no la presenta como una captura nueva. Requiere staging
zsezjtswqeijboezvado, guarda habilitada y plan sin permiso de producción.

Dentro de los 3,849 candidatos previamente revisados elige 12 códigos. Exige
identidades reales intactas, revisión y código enlazados, unidad PIECE, costo
NULL, datos SICAR iguales, vínculo Woo estable, publicación, precio público sin
promoción, descripción e imágenes. La existencia positiva entera de default
es evidencia de selección, nunca una cantidad autorizada para cargar.

Quedan fuera provisionales, altas nuevas, dudas, cambios de fuente e identidad,
fracciones y existencias no positivas o desconocidas. Los amartigones Woo
37101/37102/37103 quedan retenidos por la decisión de sólo exhibición de los
dueños del 5 de octubre. No se infiere asociación ni se cambia su estado web.
Las 12,532 exclusiones de este piloto pequeño no son otra cola de pendientes.

La selección empieza con 2396: sombrero Tombstone 30X Randa 1132, talla 59,
$2,190. El reporte local lista los doce códigos y productos. Son una selección
parcial de familias: no sustituyen variantes web ni eliminan tallas sin SICAR.
La talla 60 del sombrero continúa como referencia web, sin inventar código.

Huella de identidades del piloto final:
`8fec1a4790dc93010b2de97a1ed208d531d6e79ebb5fe18a6cfc07921258998f`.

## Ensayo y verificación

Corridas finales piloto-4 y piloto-5 idénticas: siete archivos más manifiesto.
Corridas 1–3 se conservan como intermedias; no son la selección final.
Ensayo final con `phased-guard-rehearsal.mjs`, sólo ROLLBACK: 12 códigos
permitidos dentro de la transacción y resto bloqueado. Diez controles PASS
incluyen identidad, proyección, catálogo POS, producto rápido, revisión alterada,
caducidad y ausencia de permisos de activación para clientes.

El actor ADMIN es un fixture SQL de mantenimiento, no otra aceptación de PIN
o una venta desde navegador. No hay nuevas ventas, devoluciones ni movimientos.
Las huellas y conteos de las 18 tablas son idénticos antes/después; se conservan
dos ventas, una devolución y ocho movimientos previos. Saldo físico/reservado
cero y guarda real sin activar para este piloto.

En Preview con Auth real se comprobó búsqueda exacta 2396, talla 59, saldo cero,
y ficha del sombrero con precio $2,190, descripción y tres fotos visibles cargadas.
No se guardó ni envió la ficha. Es una comprobación visual de un ejemplo,
no aceptación de las doce fichas ni prueba de existencias reales.

PASS: 758 unitarias/102 archivos, ESLint dirigido y TypeScript. Sin migración
nueva ni cambio de interfaz. Este bloque no declara otra batería nativa o una
aceptación de despliegue web que no ejecutó.

## Reproducción, evidencia y siguiente paso

Desde la copia de trabajo M9:

```text
node scripts/m9/prepare-renewed-pilot.mjs CONFIG_PILOTO_FIJADA.json SALIDA_NUEVA
```

Repetir en otra salida y comparar sha256.json. Rechaza entradas alteradas,
capturas incompletas, códigos duplicados y salidas existentes. No tiene escritor
de catálogo ni modo de producción. Los SQL de ensayo terminan en ROLLBACK;
no convertirlos a COMMIT ni reutilizarlos ante actividad concurrente.

Evidencia privada fuera de GitHub:
outputs/m9-renovacion-piloto-2026-10-19/, incluidos originales, config-piloto,
conciliacion-1/2, piloto-4/5, auditoria-antes/final, ensayo final, captura de
Preview, unitarias-final.log, resultado.json y manifiesto de evidencia.

Siguiente: confirmar a qué sucursal corresponde default y obtener cantidades
y reservas reales por código/ubicación, fecha y responsable. Preparar entonces
un plan específico de saldos del piloto con idempotencia, ensayo y reversión,
antes de repetir lector, venta, devolución y caja junto a SICAR en staging.
La actualización de catálogo, fotos o precios afectados requiere su propio
plan protegido contra cambios de destino. Las 65 etapas del corte anterior
no quedan aprobadas automáticamente por esta renovación. Producción requiere
respaldo/restauración, corte actualizado y autorización expresa independiente.
