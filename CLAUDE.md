# Instrucciones de entrega para Claude Code

## Versión visible de Vaquero HUB

- La versión canónica que ve el usuario está en `lib/release.ts`.
- En **cada entrega con cambios visibles o funcionales**, incrementa `APP_VERSION` y actualiza `APP_RELEASE`.
- Mantén sincronizado el campo `version` de `package.json`.
- Antes de entregar, toca/prueba el avatar **S** y confirma que muestre la versión nueva.
- Incluye siempre la versión publicada en el resumen para Codex, Claude Code y el usuario.
- No reutilices una versión anterior después de desplegarla en Vercel.

La versión usa SemVer mientras el sistema está en desarrollo: `0.MINOR.PATCH`.
