# Plan previo · Siete descripciones literales SICAR

Base `9b3374c`. Alcance fijo: 18221–18227. SICAR19 y SICAR22 conservan
literalmente todos los campos salvo descripción. No se decide qué significa
el texto agregado ni si los siete códigos pertenecen al mismo modelo.

1. Fijar bytes de ambas fuentes y las siete parejas originales con SHA256.
   Revalidar SELECT acotado de staging, códigos, UUIDs, proyecciones y registro
   provisional. Sólo se permiten padres individuales, atributos vacíos, sin
   contexto Woo y con web_release=false. El resto de cambios queda retenido.
2. Actualizar únicamente `public.m9_variant_details.source_description` y
   `app.m9_rows.source_row.description`. Conservar nombre del producto,
   product_name, family_key, UUIDs, Clave1, precio, costo, taxonomía, stock,
   original source_sha256 y evidencia provisional. No re-fechar la importación.
3. Reutilizar sólo el lector de contexto `m9_sicar_price_state`, nunca su DML.
   El importador general permite texto, pero reescribe SHA original y toca
   precio; no cumple este contrato. Nuevo diario APPLY/REVERSE aditivo,
   inmutable, sin grants de clientes ni service_role. Servicio invoker sólo
   postgres con ADMIN activo, products.update y compuerta staging.
4. Advisory común de catálogo y barreras Products EXCLUSIVE → Variants
   EXCLUSIVE antes de las restantes. NOWAIT libera barreras parciales mediante
   bloque de excepción; un escritor concurrente retiene la operación y exige
   reintento con contexto revalidado, sin ciclos de espera. El estado se vuelve
   a consultar bajo todas las barreras antes del primer UPDATE.
5. Replay sólo con el mismo paquete/actor y postestado exacto. Compensación
   condicionada restaura sólo los dos campos; añade recibo y auditoría, sin
   borrar historial. Cualquier edición manual o contexto web nuevo retiene.
6. Ensayo local aislado: permiso/huellas/fuente/taxonomía/stock/precio/registros,
   idempotencia, fallo después de UPDATE, compensación y carreras reales.
   Auditoría completa y rollback exacto. Root es único escritor remoto y
   genera cualquier migración forward después de revisar el SQL draft.

No se implementan 11777, 13659, 7047 ni 7522. Los 435 archivos retenidos y los
40 precios inválidos quedan fuera; ningún redondeo. Este cambio no agrega
productos vendibles ni aumenta la presencia del catálogo.

## Resultado y entrega

SELECT real acotado: **23 octubre 2026 02:53:36 UTC**. Los siete mantienen
descripción anterior, códigos/UUIDs exactos, proyección almacenada igual a la
vigente, padre provisional individual, atributos vacíos y ninguna fuente,
borrador, imagen, binding o cola web. El SHA del origen conservado sigue
`3940d108…`; no se presenta como una importación completa de SICAR22. La
procedencia nueva y las siete parejas literales quedan sólo en el recibo.

El preparador fija ambos XLSX originales y verifica archivos de entrada por
SHA256. Las siete parejas de campos literales se serializan canónicamente y se
fijan también en SQL mediante SHA256
`0284d3e543eee30602ce9d2001afffb310df44299181dd0cbd0ee0eadedf60cb`.
El SQL sólo admite los siete códigos y los dos campos descritos. El nombre
visible anterior del producto se conserva; este bloque no lo renombra ni
interpreta el sufijo como una nueva talla o agrupación.

La lectura de contexto se reutiliza del bloque Precio1; su adaptador de escritura
sigue sin cambios. Nuevo diario privado inmutable
`app.m9_sicar_description_events`, APPLY/REVERSE invoker y helpers cerrados para
anon, authenticated y service_role. Exigen postgres, ADMIN activo,
products.update y staging incluso en replay. Fechas ISO UTC con milisegundos y
roundtrip SQL, nunca `now`/`today` suministrados como fecha de observación.

Validación enfocada:

- **27 pruebas unitarias**: fuente/precio/stock/taxonomía, código, UUID,
  agrupación, atributos, nombre, evidencia original y contexto web; directorio
  nuevo y salidas wx, repetición idéntica y rechazo de archivos alterados.
- **39 controles SQL**: apply7/replay/reverse7/replay, fallo después de updates,
  drift manual, mutación de paquete, fechas ambiguas, contexto nuevo pero
  categoría/evidencia inválida, ACL cerrada e inmutabilidad. Rollback exterior
  deja **166 tablas originales idénticas**, sin conservar fixtures ni DDL del
  ensayo normal. Sólo dos campos y diario/auditoría cambian dentro del ensayo.
- Dos carreras reales en el clon asignado: escritor FOR UPDATE sobre una fila
  exacta primero → 55P03. Advisory y barreras Products/Variants liberados,
  comprobados con pg_locks mientras la transacción recuperada sigue abierta;
  el escritor termina y el paquete viejo se retiene al reintentar. En orden
  inverso, escritor bloqueado observable con pg_blocking_pids; tras commit del
  refresco termina su edición manual y se retiene la compensación. Cero deadlocks.
- Los siete fixtures comprometidos de esa segunda prueba quedan inactivos,
  conservando su historial sintético sólo en
  `qa_m9_retenidos_block5_20261022`. Seis tablas de inventario/finanzas idénticas.
  No es Auth real ni aceptación operativa. Las variaciones de precio ejercidas
  por el escritor de QA son sintéticas y no se trasladan a ningún corte real.
- Revisiones independientes de clientes y Woo sin bloqueantes; se incorporó la
  exigencia ISO y se metió try-advisory en el mismo bloque de liberación NOWAIT.

Expediente privado: `outputs/m9-descripciones-siete-2026-10-22/`, con consulta,
respuesta guardada, contexto, config, payload inerte, preparaciones reproducidas,
ensayo, carreras y manifiesto/verificador offline. La hora fija sólo reproduce
la observación, nunca la renueva; SQL exige vigencia para el primer APPLY.
Root revisa y genera cualquier migración forward. Este agente no ejecutó DDL o
DML remoto ni creó pantallas nuevas. Los otros cuatro cambios y todas las
compuertas operativas permanecen fuera de este alcance.
