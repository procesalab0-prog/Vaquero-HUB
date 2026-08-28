# Vaquero HUB

Punto de venta y plataforma de operación para Vaquero SM.

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
