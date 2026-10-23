# M9 · Preparación verificable por hitos y siguiente ensayo Woo

Plan del 22 de octubre de 2026, desde `8e47cab`. Sólo lectura local y SELECT
agregado en staging `zsezjtswqeijboezvado`. No app, main, producción,
activaciones, credenciales, pedidos nuevos ni sexto ensayo. Root conserva toda
escritura y publicación. El cierre 0.90 de 175 tablas acredita ese bloque,
no la finalización de la migración completa.

## Medición propuesta

Unidades separadas, sin suma ponderada ni porcentaje global/ETA:

1. Catálogo: intersección literal de códigos SICAR del 22 y códigos registrados
   de staging, contra el total único de ese mismo corte. Presencia no es venta
   autorizada ni evidencia de existencias. Clave 1 permanece literal.
2. Fotos: variantes con foto propia documentada y copia registrada, contra las
   variantes con foto propia dentro de esa evidencia. Las ausencias explícitas
   no son fallos de copia. Este subconjunto no representa todo Woo ni acredita
   bytes actuales, identidad vigente o publicación.
3. Inventario piloto: datos físicos completados contra tres datos por código y
   códigos con los tres datos completos contra los doce del piloto. NULL es
   pendiente, nunca existencia cero. No inferir el inventario completo.
4. Clientes/deudas: identidades documentales del archivo de detalle APARTADO
   (mapeo original más vínculo adicional exacto sobre línea antes no mapeada),
   contra las líneas de ese mismo archivo. Entregas físicas son otro indicador.
   Las 114 cuentas registradas no tienen denominador completo acreditado para
   todos los clientes; las aperturas operativas elegibles siguen sin medir.
5. Woo: primer ciclo externo completo acreditado contra el objetivo explícito
   de un piloto. Cinco ensayos sintéticos y un recibo nativo no son cinco o seis
   ciclos con pago verificado. Proveedor no acreditado significa ciclo no
   acreditado; no se cuenta la firma local QA como proveedor.

El evaluador puro valida consistencia de totales, nulls, unidades y alcances.
El preparador verifica archivos/hashes del cierre, cortes y cobertura, y genera
un expediente privado nuevo con tabla legible y JSON. No llama a SQL ni red.
Cada indicador conserva su fuente y bloqueos. Un indicador completo de un
subconjunto nunca activa un hito operativo ni una compuerta.

## Checklist mínimo tangible del siguiente puente sandbox

No se elige una marca sin evidencia del sitio de pruebas. Falta acreditar un
proveedor concreto y su cuenta/modo sandbox; las capacidades actuales revisadas
son exclusivamente sintéticas.

1. **Perfil de aislamiento revisado para un proveedor sandbox concreto.**
   `woo-remote/m9-test-isolation.php` 1.6 fija el origen de pruebas, bloquea toda
   salida HTTP, fuerza cero gateways, impide carrito/compra/webhooks y sólo deja
   guardar el pedido sintético exacto. Un gateway instalado no atraviesa estas
   guardas. Preparar una modificación forward limitada al origen, cuenta,
   endpoints sandbox y campaña aprobados; mantener denegados live, correo,
   Woo real y endpoints generales. No quitar globalmente esas protecciones ni
   activar nada en este bloque. Exigir inspección del modo y recibo del
   proveedor antes de probar una compra.
2. **Lectura del pedido real de esa campaña y evidencia independiente de pago.**
   `order-finance-read.php` sólo lee pedidos sintéticos del propietario técnico;
   `finance-read.mjs` exige cancelado, `m9_synthetic_no_payment`, transacción
   vacía, una línea y envío/impuestos/fees/cupones/reembolsos cero. Preparar un
   contrato separado para la campaña auténtica; no relajar este validador.
   Obtener ID pedido/líneas/códigos/UUID/cantidades y componentes comerciales
   completos con lectura autenticada y volver a comprobarlos. Autenticar la
   acción monetaria desde API/webhook oficial del proveedor, con cuerpo crudo,
   firma/credencial de servidor, origen/cuenta/comercio sandbox y referencia
   exacta. Status, date_paid o transaction_id Woo aislados no prueban pago.
3. **Ruta de aceptación privada y adaptador contable web autenticado.**
   `woo-sandbox-auth-quarantine.mjs` deja el receptor apagado y proveedores
   acreditados vacío. El libro `woo-web-settlement.sql` sólo admite
   SYNTHETIC_TEST_ONLY; la función financiera nativa también exige ese modo y
   M9_WEB_TEST/OTHER con caja de ensayo. No existe puente operativo listo para
   reutilizar sin cambios. Preparar SQL forward y transporte servidor
   autenticado específicos, guardias y recibo durable/idempotente; separar
   autorización/captura, fee Woo/comisión de pasarela, reembolso/recepción
   física y liquidación declarada/conciliación bancaria. No promover JSON de
   cliente o firma QA a dinero ni crear una caja/cajero ficticios. No reutilizar
   la caja física del mostrador para cuadrar un pedido web.
4. **Un solo expediente de aceptación completo y acotado, aprobado después.**
   Tras las piezas anteriores y el corte/conteo confirmado del piloto, probar
   checkout → evidencia de captura → recibo web → venta/reserva/consumo según
   política → disponibilidad, con reintentos y reconexión sin doble registro.
   Conservar descuento, impuestos, envío y fees comerciales. Probar pedido
   cambiado, referencia repetida y devolución parcial en la misma campaña;
   un reembolso sin recepción física no repone stock. Auditar antes/después,
   compensación y controles cerrados. Requiere una autorización separada de
   campaña: **este bloque no crea un sexto ensayo ni reinicia/evade el límite
   existente de cinco**. La renovación de exportación Woo es otra tarea y no
   habilita esta campaña por sí sola.

Estas son dependencias concretas para entrega, no una recomendación de construir
otro motor QA abstracto. La primera pieza externa pendiente es identificar y
acreditar el proveedor sandbox y preparar su perfil de aislamiento. Se conservan
las pruebas sintéticas ya cerradas sin ampliarlas aquí.

## Resultado medido y reproducible

El evaluador `scripts/m9/readiness-milestones.mjs` es puro. El preparador
`scripts/m9/prepare-readiness-milestones.mjs` sólo lee archivos, verifica los
103 archivos fijados del cierre 0.90 y sus fuentes, reproduce la intersección
literal y escribe una carpeta privada nueva. No importa clientes ni dispone
de cliente SQL/red. El receptor de proveedor sigue apagado.

Se conservaron dos capturas diferentes, sin reescribir la anterior:

| Indicador y alcance | Antes de las 70 altas | Después de las 70 altas |
| --- | ---: | ---: |
| Códigos del corte SICAR22 presentes | 15,891 / 16,396 (96.92%) | 15,961 / 16,396 (97.35%) |
| Códigos del corte aún ausentes | 505 | 435 |
| Códigos de staging fuera del corte | 0 | 0 |
| Copias en variantes con foto propia documentada | 5,871 / 5,871 | 5,871 / 5,871 |
| Datos físicos registrados del piloto | 0 / 36 | 0 / 36 |
| Códigos del piloto con tres datos completos | 0 / 12 | 0 / 12 |
| Identidades documentales del archivo APARTADO | 167 / 183 | 167 / 183 |
| Entregas confirmadas en ese mismo archivo | 0 / 183 | 0 / 183 |
| Primer ciclo externo de pago acreditado | 0 / 1 | 0 / 1 |

Los porcentajes de la primera fila sólo miden presencia de códigos. Las 113
ausencias explícitas de foto se conservan fuera del denominador de copia.
Cobertura fotográfica de todo Woo, denominador de todos los clientes y número
de aperturas financieras actualmente elegibles permanecen **sin medir**, no
cero. Hay 114 cuentas registradas, siete saldos/$11,910 en el libro separado de
ensayo y cero asientos en el libro nativo de crédito; son objetos diferentes.
La identidad adicional exacta se mantiene separada del archivo 166/17 original.

Capturas SELECT: `2026-10-23T01:17:04.018512+00:00` y
`2026-10-23T01:26:16.54018+00:00` (todavía 22 de octubre en México). Las
175 tablas del cierre son evidencia histórica; la segunda medición usa por
separado la auditoría posterior de root `block4_audit_after70.json`. No se
presentan las altas posteriores como si pertenecieran al cierre 0.90 anterior.
El padrón general ya supera 24h; Woo sigue fechado el 19, sin nueva exportación.

Expediente privado `outputs/m9-hitos-preparacion-2026-10-22/`: capturas agregadas
y SQL de consulta, `antes70-final/` y `despues70-final/`. Cada carpeta conserva
`preparacion.json`, `reporte.html`, evidencia del contrato local del conector y
un manifiesto de hashes de entradas y salidas. La inspección de código **no**
se etiqueta como comprobación actual del plugin remoto.

Reproducir con Node:

    scripts/m9/prepare-readiness-milestones.mjs CIERRE_DIR COBERTURA_DIR MEDICION.json NUEVA_CARPETA ISO_REVISION [AUDITORIA_MEDICION] [ARCHIVO_CODIGOS] [ARCHIVO_COBERTURA]

Verificación posterior sin escrituras:

    scripts/m9/prepare-readiness-milestones.mjs --verify CARPETA_GENERADA

La fecha de revisión es explícita: una nueva ejecución con una fecha histórica
reproduce el informe histórico; nunca vuelve vigente una captura para operar.
El preparador verifica la salida normalizada contra el recibo MCP original y
los numeradores contra su auditoría de esa fase, con nulls y bloqueos intactos.
36 pruebas unitarias propias cubren unidades, doble código, ceros/nulls,
denominadores incompatibles, código literal, foto vacía, sidecar, control
abierto, tiempo, evidencia fallida y cambio de fase con auditorías separadas.
