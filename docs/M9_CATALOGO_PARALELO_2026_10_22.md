# M9 · revisión paralela de fotos · 22 octubre 2026

Trabajo aislado desde `07b2aa4`, rama `codex/m9-paralelo-catalogo-20261022`.
Sólo SELECT a staging `zsezjtswqeijboezvado`; sin DDL/DML, descargas, Storage
uploads, Woo, inventario, UI, versión o publicación. SICAR conserva autoridad y
Clave1 literal. No se hacen agrupaciones por nombre ni inferencias de talla.

## Resultado observado

15,876 códigos administrados: 7,768 vinculados con Woo y 8,108 sólo SICAR.
De los primeros, 391 corresponden a productos simples. Hay 5,960 registros de
evidencia de variantes: 5,847 con imágenes y 113 ausencias registradas.
Las 5,847 tienen copia y coinciden en vínculo/huella de evidencia, URL, orden,
alt y metadatos de objeto. Cero objetos faltantes o metadatos discordantes en
ese alcance. Son 5,749 objetos en el bucket: archivos y variantes no se suman
como si fueran la misma unidad. No se volvieron a descargar ni verificar sus
bytes; no afirmar una nueva validación SHA256 de contenido.

Exportadas íntegramente las 1,417 variantes Woo no simples que aún no tienen
evidencia. Comparación offline contra el export autenticado del **19 octubre**,
archivo `woo.json` SHA256
`8385a6a1e9dd634bddd55598ec7449b50e6a6c0625b73e631c997fa977196d78`:

| Resultado | Variantes |
| --- | ---: |
| Siguen sin foto propia | 1,385 |
| Nuevas fotos con vínculo/atributos exactos para preparar técnicamente | 24 |
| Padre Woo33002 no publicado: conserva reserva | 5 |
| Falta vínculo guardado: no se adivina | 3 |
| Total revisado | 1,417 |

Las 24 pertenecen a siete familias Woo: 7981, 11949, 21265, 35045, 36300,
37110 y 38374. Contextos actuales de esas siete familias y 31 vínculos
individuales consultados: cero diferencias current/stored. El lote sólo incluye
24, sin completar automáticamente otras tallas de la familia.

**El lote de importación es cero.** El archivo inerte prepara 24 adiciones,
pero exige comprobar bytes y una renovación transaccional de fuente con plan,
expectativas, ensayo con rollback y auditoría. Cambiar toda la fuente afecta
25 evidencias anteriores en seis familias: deben conservarse y revalidarse
atómicamente; no actualizar su huella a ciegas ni desactivar al lector seguro.
La galería del padre permanece intacta. Cero preguntas nuevas a los dueños.

## Código y controles

- `catalogo-fotos-refresh.mjs`: plan acotado de brechas, identidad exacta,
  cambios de atributo/estado, ausencias, fuente, portadas propias y galería vacía.
- `catalogo-fotos-plan.mjs`: planificador puro de futura captura completa;
  reusa parser URL existente. No es importador y no se ejecutó sobre una captura
  completa de todas las filas: el diagnóstico completo actual usa agregados
  y el censo de las 1,417 brechas. Una exportación monolítica agotó transporte
  MCP; se abandonó sin mutaciones ni reinterpretar resultado parcial.
- `catalogo-fotos-queries.mjs`: SELECT paginados y acotados; no cliente red,
  secretos o acceso desde navegador. Evitar grandes exportaciones paralelas MCP.
- `catalogo-fotos-gap-census.sql`: censo SELECT reproducible de las brechas y
  metadatos. `catalogo-fotos-audit.sql`: doce hashes de conservación.
- `catalogo-fotos-reporte.mjs`: entradas privadas fijadas por SHA256, salida
  determinista y HTML escapado. Delega cualquier copia futura a los ejecutores
  existentes `prepareVariantPhotoCopy`/`prepareVariantPhotos`; no los duplica.

39 pruebas nuevas: repetición, no mutación, Clave1 con cero inicial, cambio de
identidad/atributos, padre no publicado, portada manual, galería guardada vacía,
ausencia no convertida en cero, objeto faltante, copia editada, censo incompleto,
huellas cambiadas, producción, parámetros de consultas inválidos y rechazo de
sobrescritura de un reporte anterior. Lint dirigido
aprobado. No se añaden dependencias o migraciones. Suite integrada la coordina
el chat principal antes de cualquier Preview.

## Evidencia privada y reproducción

Workspace principal:
`outputs/m9-catalogo-fotos-paralelo-2026-10-22/`.
Configuración, 1,417 brechas, siete contextos, 31 vínculos, consultas anteriores,
metadatos y doce huellas antes/después. Ninguna de esas filas privadas va a Git.

```sh
node scripts/m9/catalogo-fotos-reporte.mjs /ruta/privada/config.json /ruta/privada/corrida-1
node scripts/m9/catalogo-fotos-reporte.mjs /ruta/privada/config.json /ruta/privada/corrida-2
```

Ambas corridas deben usar carpetas nuevas y coincidir archivo por archivo según
`manifest.json`. El runner rechaza una carpeta ya existente y crea cada salida
con `wx`: no permite sustituir un reporte histórico.
Conservar rutas/hashes originales: no sustituir el Woo19 por otro export sin
regenerar la configuración. Auditar antes y después de una captura nueva;
no declarar actualidad operativa a partir de un export del19. Los doce hashes
de catálogo, códigos, fuentes, borradores, evidencia, copias, objetos y stock
coinciden antes/después de este bloque. La auditoría global165 de integración
pertenece al coordinador y no se atribuye a este módulo.

Siguiente paso: preparar verificación de siete URLs y renovación condicionada
24/7 que preserve las25 evidencias, ensayar primero local/staging. Mantener113
ausencias, 8,108 sóloSICAR, cinco reservas y tres enlaces sin adivinarlos. Este
avance no incrementa el96.92% medido de catálogo ni prueba operación Woo real.
