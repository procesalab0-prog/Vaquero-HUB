# Instrucciones de entrega para Claude Code

## Contexto obligatorio

- Lee completo `docs/PLAN_MAESTRO_VAQUERO_HUB.md` antes de proponer o implementar cambios relevantes.
- Actualiza su sección **Registro vivo del proyecto** cuando cambien alcance, experiencia, arquitectura, reglas operativas o estado de módulos.
- En cada entrega registra cambios, pruebas, riesgos y qué continúa siendo una simulación.
- Las instrucciones críticas del Plan Maestro tienen prioridad sobre atajos de implementación.

## Versión visible de Vaquero HUB

- La versión canónica que ve el usuario está en `lib/release.ts`.
- En **cada entrega con cambios visibles o funcionales**, incrementa `APP_VERSION` y actualiza `APP_RELEASE`.
- Mantén sincronizado el campo `version` de `package.json`.
- Antes de entregar, toca/prueba el avatar **S** y confirma que muestre la versión nueva.
- Incluye siempre la versión publicada en el resumen para Codex, Claude Code y el usuario.
- No reutilices una versión anterior después de desplegarla en Vercel.

La versión usa SemVer mientras el sistema está en desarrollo: `0.MINOR.PATCH`.
