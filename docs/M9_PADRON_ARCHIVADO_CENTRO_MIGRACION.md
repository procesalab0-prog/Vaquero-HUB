# M9 · Padrón completo observado y centro de migración · 22 octubre

Plan previo: conservar en staging el padrón visible de171 cuentas y83 documentos
ya capturados, y consultar su cola desde el programa con identidad ADMIN real.
Se trata de un archivo histórico explícito; el corte del21 no se vuelve a fechar.
No ampliar el importador operativo de61 ni abrir los$238,218 adicionales como
deuda. No crear clientes nativos, Auth, consentimiento, abonos, reservas o entregas.

Archivo privado inmutable, RLS sin acceso de datos directo, importador sólo de
mantenimiento con actor válido y staging. Un hash de fuente identifica el corte;
repetirlo conserva el archivo, modificarlo se rechaza. Claves por UUID real SICAR
y por cuenta/folio literal; nombres iguales no fusionan identidades. El detalle
documental no observado permanece pendiente y sin ID de origen inventado.

El centro de migración reunirá catálogo cargado, registro de cuentas y saldos
operativos anteriores, nuevo padrón observado y hoja del inventario piloto.
Las cantidades físicas/despachos/separados NULL siguen pendientes, nunca cero.
Cada sección enlaza su herramienta existente. No es un botón de importar todo.

Antes de conservar el archivo: preparador reproducible por SHA, dos corridas,
ensayo y replay con ROLLBACK, rechazos de identidad/campos/totales/fecha/grants,
auditoría de tablas previas. Sólo después COMMIT del archivo privado y aceptación
de búsqueda, filtros, paginación y detalle desde Preview. Reversión por rollback
del ensayo o retiro del código de consulta; conservar archivo e historia.
