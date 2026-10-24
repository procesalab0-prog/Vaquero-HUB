# M9 · Vínculos renovados, Precio1 y preparación del piloto · 24 octubre 2026

Base local f1ceb12; Preview publicado 4d77b950, árbol
86b5edb2cd6338f3ba27c70634cdeb00f906be57. Usuario autoriza continuar con tres
agentes sin tocar producción. Fuentes: SICAR22 y Woo23 autenticado, conservando
el expediente cerrado del 23. Nuevo expediente privado separado:
outputs/m9-siguiente-bloque-2026-10-24/. No renovar fechas de las fuentes por
volver a generar un reporte.

## Plan previo

1. Revisión reproducible de los 19 pares Woo cambiados. Fijar Clave1 y pares
   anteriores/nuevos; comprobar ocupación global, base literal, atributos y
   estado. Distinguir vínculo ya vigente de propuesta nueva. No decidir por
   nombre, stock entre cortes o coincidencia del analizador. Agrupar causas
   para evitar preguntas individuales innecesarias.
2. Corrección acotada de los doce precios 3416–3427, mediante el mismo escritor
   privado y diario ya instalado. Preparar protocolo/forward con hash de las
   funciones anteriores y CAS completo bajo locks. Sin nuevos padres, costos,
   existencias, Woo IDs o modificación del snapshot histórico. QA positiva
   aislada, replay/reversión/rollback/regresiones y carreras antes de cualquier
   propuesta remota. Inspeccionar el entorno local existente; no iniciar ni
   detener servicios ni alterar contenedores ajenos. Si sólo falla el acceso al
   socket por sandbox, resolver la inspección con permiso de herramienta antes
   de concluir que el motor no funciona.
3. Control operativo único de clientes/inventario del piloto, reutilizando
   lectores, hojas y protocolos existentes. Combinar requisitos comprobables
   de cantidades, compromisos y saldos; no convertir UNKNOWN o ausencia en
   cero. Mantener 36 campos físicos vacíos hasta evidencia de la tienda. No
   crear una nueva pantalla o escritor si ya está cubierto.
4. Root conserva auditoría inicial/final de 179 tablas y revisiones cruzadas.
   Integra sólo candidatos revisados, ejecuta QA apropiada y genera cierre
   reproducible. Sólo se publica Preview si hay un cambio funcional probado;
   no desplegar por artefactos o documentación.

## Compuertas

No main, producción, escritura en SICAR/Woo real, importación de stock/costos,
apertura financiera de clientes ni cobro real. Cinco ensayos Woo congelados;
no sexta campaña, proveedor, pasarela, worker o habilitación externa. Paquete
financiero anterior sigue preparado y caducado, no ejecutado ni aceptado.

Staging Supabase único zsezjtswqeijboezvado. Cualquier modificación remota exige
primero QA aislada/revisión, ensayo con reversión y auditoría. La preparación
o un test negativo no sustituyen aceptación positiva. Fuentes y evidencia
privada no entran a Git; Clave1/UUID/historial se preservan literalmente.

La cobertura 97.35% del catálogo no representa el avance global de migración.

## Resultados de integración antes de publicar

Los tres frentes se integraron tras revisión cruzada. De los 19 pares: cuatro
se mantienen, ocho requieren revisión y siete son posibles propuestas, sin DML.
Quedan sólo dos temas redactados con opciones. El control del piloto reutiliza
tres lectores protegidos y conserva UNKNOWN y NO_EVALUADO. El enlace opt-in
tiene prefetch=false para no iniciar consultas al mostrarlo.

Los doce precios tienen candidato CLI local, forward inerte y plan de QA
pendiente. No hay archivo de ensayo SQL completo ni pruebas PostgreSQL de
aplicación, replay, reversión o carreras ejecutadas para esta extensión. Código
preparado no significa instalado. El SQL está bajo scripts/, sin migración
automática ni cambio de permisos remoto.

QA raíz: 2,258 unitarias en 166 archivos, lint, tipos y build PASS. La aceptación
real queda en el expediente de cierre. La presencia del catálogo no cambia.
