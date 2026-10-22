# M9 · Integración del registro ampliado en Preview · plan previo

22 octubre2026. Tres agentes preparan adaptador general, renovación de fotos y
libro web sintético. Sólo el coordinador aplica migraciones/cargas de staging.

La página heredada actual presupone61cuentas APARTADO y limita100filas. Con el
registro adicional debe mostrar alcance real, paginar20filas sin truncar y
enlazar cada cuenta al archivo que corresponde por referencia, sin fusionar
nombres ni abrir deuda. La captura del inventario piloto conserva su API.

Nueva RPC de lectura: ADMIN activo/customers.manage/guardia staging, función
privada definer con search_path vacío y pública invoker. SELECT de registro,
fuentes y scope; filtros por nombre/ref/ID,20filas/página con orden determinista.
Reutiliza consulta anterior del piloto físico y no añade operación de escritura.
No da datos a anon/service_role. Registros generales se marcan archivo pendiente
de corte/revisión; no son socios ni saldo operativo. Actualizar resumen readonly
con cantidad real de cuentas registradas. Mantener fechas originales y NULL.

Ensayar paginación/filtro/roles en PostgreSQL local propio y staging sólo lectura;
auditar ausencia de cambios. Después de aplicar adaptadores ensayados, publicar
Preview y validar sesión real y teléfono. No main ni producción. La reversión
de interfaz no retira origen ni historia; las compensaciones de carga permanecen
separadas y auditadas. Datos/SQL reales fuera de Git, carpetas700/archivos600.
