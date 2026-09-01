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

Requisitos:

- Node.js 24 o posterior.
- pnpm 11.19.0.
- Docker Desktop en ejecución para Supabase local.

Instala las dependencias y levanta la aplicación junto con la base local:

```bash
pnpm install
pnpm dev:local
```

`dev:local` inicia Supabase, obtiene sus credenciales locales sin escribirlas en
el repositorio y arranca Next.js. Para trabajar sólo en la interfaz puede usarse
`pnpm dev`.

La instancia hospedada de Supabase no se modifica durante el desarrollo. Los
cambios de esquema se crean siempre como migraciones versionadas:

```bash
pnpm db:new -- nombre_descriptivo
pnpm db:reset
```

## Verificación

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e
```

Las variables admitidas están documentadas en `.env.example`. Nunca copies una
clave secreta a una variable `NEXT_PUBLIC_*` ni la compartas por chat.

## Versión de la interfaz

El avatar **S** de la barra superior abre el easter egg con la versión instalada. La fuente canónica está en `lib/release.ts` y debe actualizarse en cada entrega visible, siguiendo `CLAUDE.md`.
