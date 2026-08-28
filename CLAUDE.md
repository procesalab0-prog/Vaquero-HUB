# Instrucciones de entrega para Claude Code

## Contexto obligatorio

- Lee completo `docs/PLAN_MAESTRO_VAQUERO_HUB.md` antes de proponer o implementar cambios relevantes.
- Actualiza su sección **Registro vivo del proyecto** cuando cambien alcance, experiencia, arquitectura, reglas operativas o estado de módulos.
- En cada entrega registra cambios, pruebas, riesgos y qué continúa siendo una simulación.
- Las instrucciones críticas del Plan Maestro tienen prioridad sobre atajos de implementación.

## Principios permanentes

- **Seguridad desde la arquitectura:** aplica mínimo privilegio, RLS y autorización real del lado servidor; nunca expongas secretos ni confíes únicamente en restricciones de interfaz. Toda operación sensible debe ser auditable y debe revisarse pensando cómo podría explotarse o utilizarse incorrectamente.
- **El sistema se adapta al humano:** entiende primero el proceso real de Vaqueros SM; reduce pasos y captura repetitiva, prioriza operación táctil rápida, previene errores y no reproduzcas una mala experiencia de SICAR sólo por costumbre.
- Si seguridad y comodidad entran en tensión, conserva las reglas de negocio y seguridad, pero busca la interacción más sencilla que las cumpla.
- Estos principios aplican a Claude Code, Codex y cualquier agente que trabaje en el repositorio; la explicación completa vive en las secciones 28 y 44 del Plan Maestro.

## Versión visible de Vaquero HUB

- La versión canónica que ve el usuario está en `lib/release.ts`.
- En **cada entrega con cambios visibles o funcionales**, incrementa `APP_VERSION` y actualiza `APP_RELEASE`.
- Mantén sincronizado el campo `version` de `package.json`.
- Antes de entregar, toca/prueba el avatar **S** y confirma que muestre la versión nueva.
- Incluye siempre la versión publicada en el resumen para Codex, Claude Code y el usuario.
- No reutilices una versión anterior después de desplegarla en Vercel.

La versión usa SemVer mientras el sistema está en desarrollo: `0.MINOR.PATCH`.
