# Corte autenticado de Woo y ampliación de staging

El 6 de octubre se descargó el CSV nativo completo de vaquerosm.com desde
Chrome autenticado. Todas las columnas, tipos y categorías, sin metadatos
personalizados. Panel: 2,119 padres, 2,009 publicados, 86 borradores, 24 privados;
papelera excluida. El adaptador existente validó 14,245 registros:
2,119 padres y 12,126 variaciones. SICAR conserva su corte 6 del 5 de octubre;
no afirmar que SICAR también se renovó hoy.

Evidencia local: `outputs/m9-woo-actual-2026-10-06/`, fuera del repositorio.
CSV original SHA256 `cd8445ef852bbfa0ec87f78996a83d3e985ecae856ba9f8c1b537fcbf79e4b22`.
Woo normalizado SHA256 `6a4bf69ecf715010645d4d3974c7c01a80a3690df9efd1d3268f3d55f051d1e1`.

## Comparación y reservas

Contra el 1 de octubre: 1,964 padres sin cambios, 111 con cambios sólo de
inventario/disponibilidad y 44 con otros cambios para revisión técnica. Cero
IDs trasladados. 38 padres / 227 códigos ya cargados están relacionados con
estos cambios; no significa que se deban reemplazar 227 productos.

El corte real permitió detectar que `¿En inventario?` debe agruparse con los
campos excluidos de inventario. El comparador v2 corrige esa clasificación,
sin mostrar valores ni ignorar políticas de reservas. Una regresión nueva
comprueba ambos comportamientos. Las corridas 1–2 son intermedias v1: sus
107 casos incluían 63 cambios de disponibilidad. Las definitivas 3–4 son
idénticas en 25 archivos, exceptuando la configuración que contiene la ruta
absoluta de cada salida.

Se conciliaron nuevamente las 16,224 filas de SICAR. Cinco variantes cargadas
(1132, 1133, 1134, 16566, 2521) quedan retenidas porque Woo 33002, Bota Cuadra
tradicional para dama, ahora está en borrador. Se conservan UUIDs, códigos,
tallas y vínculos previos: el estado web no autoriza borrar productos SICAR.
La auditoría contra el último Woo conserva esas cinco observaciones; no se
presenta como cero diferencias ni se reemplaza el reporte original.

13 variaciones, tallas 12–24, del Botín El Ranchero Petatillo Negro (Woo 38578)
ya no aparecen en el CSV. Ninguna ausencia autoriza un borrado.
Las 199 filas con cambios de conciliación incluyen cambios comerciales y de
estado, no son 199 nuevas identidades. 179 ya estaban cargadas.

## Carga verificada sólo en staging

39 variantes pendientes pasaron la preparación inicial. Siete padres / 22
variantes permanecieron reservados por bases/nombres; 17 variantes de ocho
padres pasaron el plan original del destino, sin excepciones nuevas.

Ensayo en transacción revertida y aplicación final con siete comprobaciones:
17 creadas, cero actualizadas, repetición 17 sin cambios, 7,666 filas previas
idénticas en UUID/current/stored y cero operaciones de inventario. Cada
aplicación obtiene un plan vigente dentro de su transacción.
Payload SHA256 `d43d4fbf41418d7eb54714426294b90ee6c3a521849607a1fb24b588ee006d01`.
No hubo DDL ni relajación de controles.

Ocho fuentes/fichas nuevas y 24 fotos copiadas desde la UI del Preview.
Se verificaron las 24 copias por lectura/SHA y contra los originales de Woo,
byte por byte y en el mismo orden. Texto, base y categorías propuestas
coinciden con el paquete. Las 1,485 fuentes y 1,486 borradores anteriores
conservan sus huellas completas. Recarga de la UI: cero galerías pendientes.
La ficha Maja muestra cinco fotos, seis tallas XS–XXL y precio SICAR $1,849.

Totales finales: **7,683 / 16,224 = 47.4% del catálogo**, 8,541 pendientes:
5,937 sólo SICAR y 2,604 otros. 1,494 padres gestionados, 1,493 fuentes,
1,494 borradores. Categorías verificadas 1,238 / inválidas cero; ocho nuevas
requieren correspondencia, sin ampliar la consulta pública autorizada de
1,240 IDs. Colas remota/galería/local: 3/1/9, sin habilitar envíos nuevos.
Cero saldos y cero movimientos. `staging-despues.json` se capturó después
del catálogo y antes de las nuevas fichas; `web-despues.json` acredita los
totales editoriales finales.

La referencia aplicada combina las 7,666 filas históricas conservadas y las
17 nuevas: su auditoría exacta no debe confundirse con la auditoría del último
Woo, que mantiene las cinco reservas de estado.

## Continuación

Revisar técnicamente los 44 cambios contra fuente y borrador vigente antes de
renovar contenido. Mantener agrupadas las dudas de identidad, secciones y
familias sólo SICAR, incluida CAWRNIÑO3587. No inventar agrupaciones para cargar
las 5,937 filas. Repetir cortes antes de operar. Amartigones siguen sin compra.

427 unitarias / 60 archivos aprobados, cinco pruebas del adaptador CSV y lint
dirigido. Sin cambios de producción, Woo real, existencias, permisos,
despliegue frontend, merge ni activación de pedidos. Sol basta para este
bloque; Astra antes de pedidos, devoluciones o inventario central.
