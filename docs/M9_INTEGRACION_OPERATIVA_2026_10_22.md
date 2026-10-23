# M9 · Integración operativa de Preview 0.92

Plan coordinado del 22 de octubre de 2026, base `764f742`. Sólo staging
`zsezjtswqeijboezvado` y rama `codex/m9-staging-review`; sin main, producción,
Woo real, existencias, costos, saldos, cobros o entregas operativas. Root es el
único escritor y responsable del despliegue. Tres agentes trabajan en clones
locales separados; los revisores no aplican SQL remoto.

## Alcance y secuencia

1. Reutilizar el archivo histórico para consultar las 435 referencias retenidas
   del corte SICAR22. Índice inmutable, 433 proyecciones reutilizadas, un delta
   de precio de referencia y una referencia nueva; ningún producto vendible.
   Ensayar archivo/repetición/retiro/repetición con rollback y auditoría completa;
   sólo después conservar el índice y verificar su lectura autenticada.
2. Capturar respuestas documentales por folio completo en el diario existente.
   ADMIN activo, origen de formulario, revisión optimista, fuente vigente y nonce;
   autor/fecha/evidencia derivados en servidor. «Aún no se sabe» no resuelve el
   pendiente. SX00000 sólo admite UNKNOWN. Ensayo técnico UNKNOWN y retirada,
   sin inventar una respuesta de los dueños ni cantidades entregadas. El archivo
   fuente mantiene sus 183 líneas UNKNOWN aunque se agregue una declaración.
3. Reforzar la hoja existente de doce códigos con evidencia por campo. Vacío
   sigue siendo NULL; cero requiere declaración expresa igual que otro número.
   Fuente/actor/fecha se conservan por campo, sin recertificar al cambiar una
   nota. La fecha es la del registro actual, no una fecha histórica de conteo.
   La deriva de catálogo/fuente/saldo retiene evidencia. No abrir inventario.
4. Integrar, verificar permisos y carreras reales locales, auditar staging,
   ejecutar pruebas completas y desplegar únicamente Preview. Probar desde la
   sesión real del programa y comprobar que no se abrieron compuertas.

## Corte complementario de Woo

Captura pública terminada el 23oct02:04UTC (22oct México): 2,064 padres, todos
con ID ya presente en el CSV autenticado del 19 de octubre. Nueve se observan
públicamente aunque aquel CSV los conservaba como borradores. 110 padres del
CSV no se observaron en el endpoint público: no se eliminan ni se les atribuye
un estado nuevo. El CSV histórico tiene 2,174 padres, incluidas sus fuentes
privadas y variaciones. La captura pública no sustituye la renovación completa
autenticada, pendiente de que el usuario desbloquee Chrome.

El capturador original se ejecutó con modo público, sin claves ni cookies,
únicamente GET a Store API, paginación comprobada y rechazo de redirecciones.
No envió códigos SICAR, UUID internos, saldos ni credenciales. El comparador
reproducible nuevo no genera operaciones de escritura. Conserva diferencias
literales de HTML/URLs; no afirma que cambió una foto por una reescritura CDN,
ni corrige categorías comparando representaciones diferentes.

Dos ejecuciones produjeron comparación idéntica. Evidencia privada en
`outputs/m9-woo-publico-complementario-2026-10-22/`. Capturador fijado por SHA256
`6c6b1197bb03c64f8bb355d81127683944ace5af10f41207cf9722f70f1278d7`.

## Medición que permanece vigente

15,961 de 16,396 códigos SICAR del corte22 presentes en staging: 97.35% de
presencia literal, no porcentaje global ni preparación operativa. Las 435
referencias retenidas no aumentan ese numerador. Sus motivos se superponen:
316 exhibición, 86 taxonomía, 40 precio inválido y 3 conflictos de categoría.
Los 40 precios incluyen 38 con precisión extra y dos ceros; no redondear ni
inventar su precio final. Se muestran datos y motivos conservando la fuente.

Los 36 campos físicos del piloto y las entregas requieren evidencia real.
SICAR sigue siendo maestro. Los cinco ensayos conectados Woo ya agotaron su
cupo; no añadir otro ni resetearlo. Worker, captura, finanzas, checkout y
apertura de stock permanecen cerrados. No se declara lista una operación real
por completar una pantalla documental.

## Evidencia de cierre

El expediente privado de esta integración se conserva en
`outputs/m9-integracion-operativa-2026-10-22/`; las pruebas de cada agente tienen
expediente independiente. Los resultados finales, despliegue y limitaciones se
agregan al cerrar la verificación desde Preview.
