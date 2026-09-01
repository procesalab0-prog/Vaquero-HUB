import { spawnSync } from "node:child_process";

import { getSupabaseLocalEnv } from "./supabase-local-env.mjs";

const localEnv = getSupabaseLocalEnv();
const bootstrapCode = `BOOT${Date.now().toString().slice(-8)}`;
const bootstrap = spawnSync("node", ["scripts/bootstrap-admin.mjs"], {
  env: {
    ...process.env,
    ...localEnv,
    ADMIN_EMAIL: `${bootstrapCode.toLowerCase()}@vaquero.test`,
    ADMIN_PASSWORD: "Bootstrap-M1-2026!",
    ADMIN_EMPLOYEE_CODE: bootstrapCode,
    ADMIN_FULL_NAME: "Administrador de prueba",
  },
  stdio: "inherit",
});

if (bootstrap.status !== 0) {
  process.exit(bootstrap.status ?? 1);
}

const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "tests/integration"],
  {
    env: {
      ...process.env,
      ...localEnv,
    },
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
