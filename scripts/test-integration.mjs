import { spawnSync } from "node:child_process";

import { getSupabaseLocalEnv } from "./supabase-local-env.mjs";

const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "tests/integration"],
  {
    env: {
      ...process.env,
      ...getSupabaseLocalEnv(),
    },
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
