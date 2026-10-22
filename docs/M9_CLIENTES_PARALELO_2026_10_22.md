# M9 · Evaluador de apertura de clientes por etapas · 22 octubre 2026

Bloque paralelo autorizado por Emmanuel. Rama propia derivada de `07b2aa4`;
no cambios a la rama principal, la aplicación, las migraciones ni las versiones.
Sólo consultas SELECT al proyecto de staging `zsezjtswqeijboezvado`; no navegador,
SICAR/Woo, escritura remota ni apertura de deuda. Reutiliza el conciliador
`reconcile-general-credit-details.mjs`, no crea otro importador.

## Decisión y límites

El nuevo `scripts/m9/clientes-stage-gate.mjs` reconstruye la conciliación desde
sus cuatro entradas originales fijadas por SHA256. Conserva la fecha original:
no vuelve a fechar capturas para superar la caducidad. El plan reconstruido es
exactamente el archivado en Preview: SHA256
`a8897dc2883ddfd0bbdcae2deb08b16ab9b4f07bf9741565c2c2f682d90ae205`.

Compara cada documento y abono contra una instantánea de destino reciente
obtenida por una sola consulta SELECT. Incluye registro de origen/heredado,
documentos, pagos activos/cancelados, historia de apertura en ambos libros y
mapeo literal actual de Clave 1. Una fixture se distingue por su alcance de lote
`SYNTHETIC_QA_NOT_SICAR`, nunca por su nombre. No convierte esa fixture en una
cuenta SICAR ni fusiona por teléfono o nombre.

La selección es por cuenta completa: si un documento abierto de la cuenta
requiere revisión, la cuenta entera se retiene. El resultado permite sólo
`CANDIDATE_STAGING_REHEARSAL_ONLY`, `HOLD_ACCOUNT` o archivo pagado. Incluso
con un candidato confirmado, `operational_import_allowed` permanece `false`:
un JSON local no autentica al aprobador ni autoriza una apertura. La posterior
acción de mantenimiento conserva sus permisos, ensayo, auditoría y aprobación.
Este módulo no genera SQL, realiza llamadas de red ni ejecuta importaciones.

La elegibilidad financiera y la entrega son dimensiones separadas:

- `money_opening_eligibility`: candidato de ensayo, retenido o pagado para archivo.
- `stock_operations_allowed` y `delivery_operations_allowed`: siempre `false`.
  Las entregas UNKNOWN y las cantidades NULL siguen desconocidas.
- Variante ausente/ambigua o código con controles internos retienen la operación
  física; no se limpia, trunca ni cambia la Clave 1. Eso no impide por sí solo
  abrir una deuda puramente financiera cuyo titular, importe y corte estén
  acreditados por separado.
- Sin historial vinculado completo se conserva una advertencia documental.
  Un cero activo explícito y conciliado puede ser candidato financiero con
  corte completo/revisión; la mera ausencia de un botón o consulta no prueba cero.
  No se inventan abonos cancelados ni se reproducen los históricos en caja.

## Compuertas

1. Corte del subconjunto observado, completo por cuenta, reciente y sin fechas
   futuras. El alcance no se transforma en padrón completo ni cierre simultáneo.
   Se exige la fuente fijada, almacén Default→La Piedad, sumas y evidencia explícita
   de cierre. Las fechas deben ser ISO UTC canónicas y calendáricamente válidas:
   `Date.parse` por sí solo acepta normalizaciones de fechas imposibles.
2. Revisión de identidad/finanzas anclada a la huella exacta del documento,
   pagos activos/cancelados y líneas. Cambiar la evidencia invalida la revisión.
   Sólo pueden resolverse discrepancias concretas previstas; no se puede
   dispensar aritmética, historial de apertura ni una identidad distinta.
3. Cada abono se compara por identidad, importe y estado, aunque la suma total
   siga siendo igual. Altas, ausencias, cancelaciones y reactivaciones se retienen.
4. Un documento con apertura heredada o nativa, incluso compensada, nunca se
   vuelve a abrir. Una diferencia requiere su plan de conciliación/compensación.
   No se sobrescribe ni reduce deuda silenciosamente.
5. El importador APARTADO vigente no se extiende a los nuevos documentos por
   emitir este reporte. Sin adaptador de origen/documento, la cuenta se retiene.
   No se crean clientes nativos, Auth, consentimiento, entregas ni reservas.

## Resultado con la evidencia disponible

El corte documental observado contiene 60 cuentas y 84 documentos: 83 abiertos
en 59 cuentas, más una cuenta liquidada con un documento pagado. Saldo observado
$240,558; 95 abonos históricos, 92 activos por $70,589 y tres cancelados por
$1,850 excluidos. No es una apertura nueva ni un cierre simultáneo acreditado.

- Cero cuentas/documentos candidatos a una nueva apertura de ensayo en este corte:
  falta cierre acreditado/revisión de identidad y el adaptador del alcance general.
- Siete documentos de seis cuentas ya tienen historia de apertura en staging;
  conservarla y conciliarla, nunca duplicarla.
- 76 documentos abiertos de 53 cuentas requieren el adaptador del alcance
  general; el documento pagado adicional tampoco se reabre.
- Ocho documentos de siete cuentas conservan discrepancia de nombre histórico.
  Son revisiones concretas, no 83 preguntas nuevas a los dueños.
- Los 36 documentos con cero activo explícito e historial vinculado no observado
  conservan una advertencia; no se añade un bloqueo financiero artificial.
- 183 líneas de mercancía, 166 con variante literal y 17 pendientes. Todas las
  entregas siguen UNKNOWN; reserva y descuento de inventario permanecen NULL.

Las instantáneas de destino incluyeron 61 fuentes reales y una fixture sintética;
61 registros heredados, 75 documentos de origen (incluye dos de fixture), ocho
antecedentes de abono y siete cargos heredados. La selección y los totales de
SICAR no incorporan la fixture. Dos lecturas de las proyecciones de origen,
pagos, aperturas y mapeos resultaron iguales; no se afirma auditoría global de
165 tablas a partir de esta comprobación parcial.

70 pruebas nuevas del evaluador y 130 pruebas con sus cuatro módulos relacionados
PASS; suite completa 1,261 pruebas/127 archivos PASS; ESLint y Prettier puntuales PASS. Pruebas cubren cortes viejos/incompletos,
fechas imposibles, cambios de pagos con sumas iguales, cancelación/reactivación,
doble apertura/compensación, cuenta atómica, código literal con controles,
ausencia de consentimientos fabricados, separación financiera/física, cero
activo explícito, huellas de revisión y rechazo de archivo cambiado.

Dos corridas finales con las mismas entradas y fecha de evaluación son idénticas
byte por byte. Expediente privado fuera de Git:
`outputs/m9-clientes-etapas-paralelo-2026-10-22/`, corridas 9 y 10. Conserva
consulta SELECT, instantánea de destino, configuración fijada, reporte agregado
sin PII, evaluación privada por cuenta/documento, comparación y manifiesto.

## Reproducción y siguiente bloque

Desde el repositorio:

```sh
node scripts/m9/clientes-stage-gate.mjs CONFIG_FIJADA.json DIRECTORIO_NUEVO
```

La configuración contiene `assessment_at` y `inputs` con cuatro entradas:
`source_config` y `destination` con ruta/SHA256; `cut` y `reviews` con ruta/SHA256
o `null` si no están acreditados. `source_config` es la configuración ya existente
del conciliador de detalles. El módulo nunca cambia esos archivos.

Antes de proponer un lote operativo: ampliar el adaptador privado para las
identidades/documentos del padrón general preservando los anteriores; ensayarlo
con rollback y dos corridas; acreditar una tanda de cuentas con corte renovado;
conciliar por separado las siete aperturas existentes; aplicar después sólo
cuentas completas autorizadas. La entrega y la mercancía física tienen su propio
plan y evidencia. No hace falta detener el trabajo técnico ni emitir preguntas
por cada código para avanzar con ese adaptador.
