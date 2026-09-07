# Auditoría ergonómica intermedia M5.5

> Fecha: 2026-09-06  
> Entrega: 0.25.0  
> Alcance: recorridos frecuentes ya construidos; no sustituye el piloto con
> empleados ni las pruebas con cámara, lector e impresora reales.

## Método y dispositivos

La revisión compara el recorrido anterior con el corregido y verifica
desbordamiento, desplazamiento, objetivos táctiles, conservación de contexto y
uso por teclado. Se ejecuta en teléfono vertical (390 × 844), iPad horizontal
(1180 × 820) y computadora (1440 × 900).

Los tiempos humanos se medirán durante el piloto con personal de Vaqueros SM.
Inventar un tiempo a partir de una prueba automatizada daría una falsa medida;
por ahora se registran las interacciones objetivas y las regresiones de
navegador.

## Hallazgos corregidos

| Prioridad | Recorrido             | Antes                                                                         | Corrección 0.25.0                                                                                         | Resultado comprobable                                                          |
| --------- | --------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Crítica   | Alta multivariante    | Ocho tallas exigían ocho toques individuales                                  | Selección completa, limpieza y rango Desde–Hasta; la matriz sigue editable                                | Ocho tallas consecutivas se marcan con dos selecciones y una confirmación      |
| Crítica   | Conteo físico         | Cada variante exigía elegir producto, capturar, guardar y esperar una recarga | Captura continua con Enter, avance automático, foco conservado, búsqueda por nombre/SKU/código y progreso | Se capturan 20 variantes consecutivas sin recargar ni abrir otro formulario    |
| Alta      | Solicitud de traspaso | La lista mostraba hasta 500 renglones sin búsqueda                            | Filtro por nombre, talla, color, SKU o código; conserva cantidades aunque cambie el filtro                | Se encuentra mercancía sin recorrer toda la lista y no se pierde lo ya elegido |

## Interacciones

- **Alta de 2 colores × 8 tallas:** pasó de 10 selecciones individuales a 5
  acciones (2 colores, inicio de rango, fin de rango y confirmar rango). Si
  aplican todos los colores y tallas, son 2 acciones.
- **Conteo de 20 variantes:** eliminó 20 selecciones de producto y 20 recargas.
  Cada renglón requiere sólo escribir la cantidad y presionar Enter; después el
  foco queda listo en el siguiente.
- **Traspaso:** la búsqueda reduce la lista antes de capturar y muestra cuántos
  renglones ya están seleccionados.

## Matriz de comprobación

| Recorrido                | Teléfono vertical            | iPad horizontal          | Computadora/teclado                      |
| ------------------------ | ---------------------------- | ------------------------ | ---------------------------------------- |
| Alta por rango y matriz  | Sin desbordamiento           | Sin desbordamiento       | Operable con teclado                     |
| Conteo continuo de 20    | Enter avanza y conserva foco | Modal desplazable        | Enter avanza y permite corregir capturas |
| Traspaso con búsqueda    | Controles apilados           | Lista y resumen visibles | Filtro y cantidades conservadas          |
| Venta y ticket en espera | Regresión de M4              | Regresión de M4          | Regresión de M4                          |
| Acciones en lote         | Regresión de M2.5            | Regresión de M2.5        | Regresión de M2.5                        |

La suite completa de navegador es la evidencia automatizada de regresión: 46
pruebas pasaron en la corrida local de producción. El CI del PR debe quedar
verde antes de fusionar esta auditoría.

## Pendiente antes del piloto

1. Medir con al menos un cajero y una persona de almacén el tiempo real de cada
   recorrido y anotar confusiones o trabajo innecesario.
2. Imprimir y escanear una etiqueta real con el lector y con la PWA instalada.
3. Probar ticket térmico real y el desplazamiento en los iPad que usará la
   tienda.

Estos pendientes son físicos; no bloquean el analizador en seco de SICAR M9,
pero sí deben cerrarse antes del piloto productivo.
