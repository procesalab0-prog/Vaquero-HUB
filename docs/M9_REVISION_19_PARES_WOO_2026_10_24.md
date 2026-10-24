# Revisión protegida de los 19 pares Woo · 24 octubre 2026

Plan previo, base `f1ceb12`, sólo análisis offline. Fuente: expediente cerrado
SICAR22/Woo19/Woo23 y snapshot de staging anterior a la exportación Woo23.
No captura nueva, DDL, SQL ejecutado, red, importador ni pantalla.

Reutilizar el conciliador `m9-readonly-5` ya reproducido y su lector Woo, fijados
por SHA, y el ensamblador de las 32 páginas gestionadas actuales. No implementar
otro matching ni equivalencias de tallas, nombres, acentos o existencias.
Validar cada Clave1 literal y los campos SICAR idénticos entre conciliaciones;
calcular los 19 pares realmente distintos sobre las 16,396 filas, no tomar los
1,154 impactos editoriales como cambios de identidad.

Cada fila conserva pares históricos/nuevos/nativos, UUID, base de descripción
corta literal y base extraída por el lector existente, publicación, atributos,
regla canónica y ocupación del destino en todo el snapshot. Comparar también
ocupación del padre por otro producto nativo: un cambio de base no autoriza
transferir un padre ya usado a otra familia SICAR.

Tres juicios documentales, todos sin aplicar:

- **Mantener** cuando staging ya tiene exactamente el par propuesto por el
  analizador. No crea aprobación comercial ni actualización de contenidos.
- **Revisión** si pierde coincidencia, hay ocupación por otro código/producto,
  cambió la identidad o faltan las condiciones exactas. Conservar vínculo
  histórico; ausencia o nuevo prefijo no autorizan desasignar.
- **Posible propuesta** sólo si la coincidencia canónica es única y publicada,
  todos sus atributos constan exactamente, no hay ocupación por otra variante o
  familia nativa y la variante SICAR sigue sin vínculo. Es insumo para un futuro
  plan protegido; no autoriza agrupar, asignar IDs, fotos, precios o inventario.

Separar causas técnicas y consultas mínimas a dueños. Ejemplos iniciales: una
misma soga cambia `Cafe` a `CAFÉ`; un padre de camisa cambia de base y ahora
reclama códigos de otra familia, con al menos un destino ya ocupado. No resolver
esos casos mediante existencias o parecido de nombre. La publicación de un
borrador no crea por sí sola un nuevo artículo.

Dos corridas idénticas a carpetas nuevas, entrada/código fijados, verificador
offline y negativas: colisión de destino/padre, duplicado de código, deriva de
Clave1/campos/UUID, atributos o publicación incompatibles y NULL sin inventar.
Rollback: no procede para datos porque no hay mutación. Cualquier aplicación
posterior requiere otra captura actual, precondiciones bajo lock, ensayo con
reversión/auditoría y autorización del alcance por root.

## Resultado

Sobre las 16,396 filas SICAR y las 15,961 variantes observadas globalmente:

- Cuatro pares ya coinciden con los IDs nativos: 18006, 18010, 6223 y 7961.
  Mantener significa **cero DML necesario para el vínculo**; no renovar contenido
  ni declarar elegibilidad. 7961 conserva un diagnóstico de stock entre cortes,
  sin perder su identidad ni convertirlo en conteo actual.
- Ocho quedan en revisión: 17206 por `Cafe`→`CAFÉ`, y las seis tallas 17807–17812
  junto con 17850 por reutilización/cambio de base del padre de camisa 38370.
  El destino 38370/38435 que ahora coincide con 17810 ya está ocupado por 17850;
  las seis nuevas candidatas apuntan a un padre ligado a otra familia nativa.
  No se mueve variante, historial, reserva, venta ni saldo.
- Siete son sólo evidencia para una posible propuesta: cinco polainas
  (18037–18039 y 18041–18042) y dos gorras (18152 y 18169). Publicación/atributos
  exactos o base corregida no bastan para aplicar: falta estado fresco completo,
  revisión de la estructura nativa, plan protegido y ensayo. Ningún ID se asignó.

Quedan dos temas para dueños, con tres opciones sin preselección, ejemplos
legibles y códigos/evidencia como apoyo: camisa azul marino frente a azul obscuro,
y corrección ortográfica del color de soga. Son borradores privados al final del
reporte; no se enviaron mensajes ni se publicaron preguntas en main/producción.

Dos corridas finales (`corrida-2` y `corrida-3`) idénticas. La primera corrida
preliminar se conserva. 15 pruebas unitarias enfocadas, lint y diffcheck PASS;
inputs privados y módulos del lector histórico fijados por SHA. No se duplicó
matching: `readWoo` y las reglas `m9-readonly-5` del expediente cerrado aportan
bases/atributos y resultados; se añadió sólo la revisión de ocupación global.
El verificador lee archivos y recalcula la revisión; no crea otro reporte ni
contacta servicios. No hubo SQL, red, navegador, datos operativos o compuertas.
