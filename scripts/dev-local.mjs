import { spawn, spawnSync } from "node:child_process";

import { getSupabaseLocalEnv } from "./supabase-local-env.mjs";

const database = spawnSync("pnpm", ["exec", "supabase", "start"], {
  stdio: "inherit",
});

if (database.status !== 0) process.exit(database.status ?? 1);

const app = spawn("pnpm", ["exec", "next", "dev"], {
  env: {
    ...process.env,
    ...getSupabaseLocalEnv(),
  },
  stdio: "inherit",
});

app.on("exit", (code) => process.exit(code ?? 0));
