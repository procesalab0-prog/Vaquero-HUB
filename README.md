# Vaquero-HUB

Sistema propio de gestión (POS, inventario, sucursales, WooCommerce,
clientes, reportes) desarrollado por ProcesaLab para Vaqueros SM, en
sustitución progresiva de SICAR.

Antes de implementar cualquier módulo, leer el contexto completo del
proyecto:

- [`docs/CONTEXTO_MAESTRO.md`](docs/CONTEXTO_MAESTRO.md) — alcance,
  reglas de negocio, modelo conceptual, arquitectura, roadmap y
  requerimientos del cliente (documento vivo, se actualiza conforme se
  confirman más detalles con el cliente).
- [`docs/PLAN_CODEX.md`](docs/PLAN_CODEX.md) — plan de ejecución para
  Codex: decisiones técnicas cerradas, reglas innegociables, milestones
  con criterios de aceptación, y la secuencia de corte de SICAR y
  conexión con WooCommerce.

**Roles:** Codex implementa, Claude Code revisa (arquitectura,
concurrencia, RLS, dinero, historial), y el merge lo aprueba un humano.
