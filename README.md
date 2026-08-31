# Vaquero HUB

Punto de venta y plataforma de operación para Vaquero SM.

Antes de implementar cualquier módulo, consulta:

- [`docs/PLAN_MAESTRO_VAQUERO_HUB.md`](docs/PLAN_MAESTRO_VAQUERO_HUB.md): contexto canónico, reglas críticas y registro vivo.
- [`docs/PLAN_CODEX.md`](docs/PLAN_CODEX.md): decisiones técnicas, milestones, criterios de aceptación y orden de ejecución.
- [`docs/RUNBOOK_CORTE.md`](docs/RUNBOOK_CORTE.md): ensayos, migración, validación, rollback y encendido posterior de WooCommerce.

**Roles:** Codex implementa, Claude Code revisa arquitectura, concurrencia, RLS, dinero e historial, y el merge lo aprueba una persona de ProcesaLab.

## Estado actual

La primera base incluye un POS navegable con datos simulados, carrito, cobro de demostración, tickets de regalo, productos e inventario. La apariencia se ajustará al sistema visual aprobado en Claude Design.

## Desarrollo local

```bash
pnpm install
pnpm dev
```

No hay conexiones a Supabase, WooCommerce ni proveedores de pago en esta etapa.

## Versión de la interfaz

El avatar **S** de la barra superior abre el easter egg con la versión instalada. La fuente canónica está en `lib/release.ts` y debe actualizarse en cada entrega visible, siguiendo `CLAUDE.md`.
