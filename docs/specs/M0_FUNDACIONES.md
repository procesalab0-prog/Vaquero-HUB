# M0 — Fundaciones del repositorio

> Especificación para Codex. Ver [`../PLAN_CODEX.md`](../PLAN_CODEX.md)
> para las reglas generales y la Definition of Done.
>
> **Este milestone no necesita la base de datos.** Se puede empezar de
> inmediato y todo se valida contra Supabase local.

## Objetivo

Que un desarrollador clone el repositorio, ejecute un comando y tenga la
aplicación y la base de datos corriendo en local, con CI en verde.

## Alcance

### 1. Aplicación

- Next.js con App Router y TypeScript en modo estricto.
- Tailwind CSS.
- ESLint + Prettier, con la configuración corriendo en CI.
- Una sola página que muestre el estado de conexión a Supabase. Nada más:
  este milestone es andamiaje, no producto.

### 2. Base de datos local

- Supabase CLI inicializado, con `supabase/config.toml` versionado.
- Carpeta `supabase/migrations/` con una migración inicial que sólo cree
  el esquema `app` y la extensión `pgcrypto` en el esquema `extensions`.
- Carpeta `supabase/seed.sql` preparada (vacía por ahora).
- **Nunca** se aplican cambios de esquema desde el panel de Supabase.

### 3. Separación de claves

Éste es el punto que más importa de M0. Debe quedar imposible por
construcción exponer la llave de servicio al navegador.

- `.env.example` con los nombres de variables y sin un solo valor real.
- Variables de cliente: únicamente `NEXT_PUBLIC_SUPABASE_URL` y
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Variable de servidor: `SUPABASE_SECRET_KEY`, que **jamás** se
  importa desde un componente de cliente.
- Las llaves heredadas `anon` y `service_role` no se usarán en código nuevo;
  Supabase recomienda las llaves `publishable` y `secret` actuales.
- Dos clientes de Supabase en módulos separados y con nombres explícitos:
  uno para el navegador y otro para el servidor. El módulo del servidor
  lleva la directiva `import 'server-only'` en la primera línea, para que
  la compilación falle si alguien lo importa desde el cliente.
- Regla de ESLint que prohíba importar el módulo de servidor desde rutas
  de cliente.

### 4. Pruebas

- **Vitest** configurado con un test trivial que pase.
- **Playwright** configurado con un test trivial que abra la página.
  Usar el Chromium ya instalado en el entorno; no descargar navegadores.
- Estructura de carpetas lista para las tres clases de prueba que vienen
  después: unitarias, de integración contra Supabase local, y e2e.

### 5. Integración continua

Un workflow de GitHub Actions que en cada PR ejecute, en este orden:

1. `lint`
2. `typecheck`
3. Levantar Supabase local y **aplicar todas las migraciones sobre una
   base vacía** — si una migración no aplica limpia, el PR falla.
4. Tests unitarios y de integración.
5. Tests e2e.

### 6. Documentación

- `README` de desarrollo: requisitos, cómo levantar el proyecto, cómo
  correr las pruebas, cómo crear una migración nueva.
- Enlace al plan y al contexto maestro.

## Fuera de alcance

- Autenticación, tablas de negocio, interfaz real. Todo eso es M1 en
  adelante.
- Despliegue a Vercel. Se configura cuando exista el proyecto de Supabase.

## Criterios de aceptación

- [ ] `git clone` + un comando documentado deja la app y la base
      corriendo en local.
- [ ] CI en verde en un PR limpio.
- [ ] Las migraciones aplican sobre una base vacía sin intervención
      manual.
- [ ] Importar el cliente de servidor desde un componente de cliente
      **rompe la compilación**. Debe existir una prueba o una regla de
      lint que lo demuestre.
- [ ] No hay un solo valor de secreto en el repositorio.
