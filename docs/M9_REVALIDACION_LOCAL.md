# Revalidación local supervisada



## Revalidación supervisada y recorrido de bolsa — 2026-10-05, 0.67.0

Nueva herramienta prepare-revalidation.mjs produce sólo lecturas contra Woo local. Compara TODOS los campos contra la evidencia original salvo date_modified/date_modified_gmt de primer nivel; cualquier cambio comercial/identidad bloquea. Registro con motivo, hash de evidencia anterior, tienda/producto/target y snapshots nuevos. El puente valida la evidencia anterior íntegra antes de aplicar el registro; liga su hash al diario y conserva el registro en la evidencia del nuevo recibo. Preflight y guard final siguen comparando el snapshot completo; no se ignoran fechas durante el envío. No detecta ABA ni controla escritores externos.

Recorrido real autorizado: UI staging bolsa10521, revisión3 con nombre temporal→cola→claim38ffe5a3-76dc-4c17-990a-f05b57b38c61→revalidación→Woo local18→recibo SUCCEEDED visible. UI revisión4 restaura nombre→claime9f1db4a-caf5-4746-96f3-6b021bb6f4d0→puente normal sin otra revalidación→mismo ID18 y recibo visible. Campos comerciales originales, cuatro fotos, código10521 y precio8695 conservados; cero solicitudes al repetir worker. Comprobantes anteriores sin modificaciones. Sólo escritura de ficha/cola en staging y borrador Woo local, nunca producción ni existencias. Evidencia outputs/m9-revalidacion-2026-10-05.

194 unitarias locales aprobadas, incluyendo13 nuevas de revalidación; lint dirigido aprobado. Versión preparada0.67.0; despliegue y CI de esta versión pendientes al guardar este registro. CI286 aprobó0.66.0 con181/165/128 pruebas, no sustituye la nueva validación. Staging sigue abierto por control de escritores externos y revisión final del lote; no se declara revalidación productiva.

Uso desde la raíz del repositorio:

```sh
node scripts/m9/woo-test/prepare-revalidation.mjs CLAIM_JSON PREVIOUS_VERIFIED_DIR LOCAL_RUNTIME NEW_OUTPUT_FILE "Motivo documentado de la revisión"
node scripts/m9/woo-test/staging-bridge.mjs CLAIM_JSON LOCAL_RUNTIME NEW_OUTPUT_DIR PREVIOUS_VERIFIED_DIR REVALIDATION_FILE
```

La herramienta no afirma aprobación comercial: el operador revisa el origen de las fechas distintas y entrega expresamente ese archivo al puente. No editar el recibo anterior ni sus archivos para cambiar su hash. No reutilizar otro archivo de revalidación en un diario iniciado: se rechaza. Si hay cambios fuera de fechas, detenerse y revisar. La nueva evidencia conserva íntegro el registro y la referencia al comprobante anterior. Este mecanismo es local y supervisado, no un canal productivo ni bloqueo de wp-admin.
