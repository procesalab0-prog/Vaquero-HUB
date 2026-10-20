import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const [configPath, output] = process.argv.slice(2);
if (!configPath || !output)
  throw Error("Usage: node prepare-legacy-cash-trial.mjs config.json output");
const cfg = JSON.parse(readFileSync(configPath, "utf8"));
const raw = readFileSync(cfg.plan_path);
if (createHash("sha256").update(raw).digest("hex") !== cfg.plan_sha256)
  throw Error("PLAN_PIN_MISMATCH");
const plan = JSON.parse(raw);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
for (const key of ["actor", "request", "account", "session"])
  if (!uuid.test(cfg[key] ?? "")) throw Error("EXPLICIT_UUID_REQUIRED:" + key);
if (
  cfg.synthetic_test_only !== true ||
  cfg.project !== "zsezjtswqeijboezvado" ||
  plan.scope !== "APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS"
)
  throw Error("STAGING_TRIAL_REQUIRED");
const source = plan.accounts.find((a) => a.registry_id === cfg.account);
if (!source) throw Error("ACCOUNT_NOT_IN_PINNED_PLAN");
if (!Array.isArray(cfg.parts) || cfg.parts.length < 1 || cfg.parts.length > 3)
  throw Error("PARTS_REQUIRED");
const seen = new Set();
let sum = 0,
  cash = 0,
  change = 0;
for (const p of cfg.parts) {
  if (
    !["CASH", "CARD", "TRANSFER"].includes(p.method_code) ||
    seen.has(p.method_code) ||
    !Number.isSafeInteger(p.amount_cents) ||
    p.amount_cents <= 0 ||
    p.amount_cents > 999999999
  )
    throw Error("INVALID_PART");
  seen.add(p.method_code);
  sum += p.amount_cents;
  if (p.method_code === "CASH") {
    if (
      !Number.isSafeInteger(p.tendered_cents) ||
      p.tendered_cents < p.amount_cents ||
      p.tendered_cents > 999999999
    )
      throw Error("TENDER_REQUIRED");
    cash += p.amount_cents;
    change += p.tendered_cents - p.amount_cents;
  } else if (
    typeof p.reference !== "string" ||
    !p.reference.startsWith("ENSAYO:") ||
    p.reference.length > 100
  )
    throw Error("EXPLICIT_TRIAL_REFERENCE_REQUIRED");
}
if (
  sum >
    source.documents
      .filter((d) => d.status === "OPEN")
      .reduce((n, d) => n + d.balance, 0) ||
  sum > 999999999
)
  throw Error("OVERPAYMENT");
const literal = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const input = {
  request: cfg.request,
  account: cfg.account,
  session: cfg.session,
  parts: cfg.parts,
};
const call = `public.m9_legacy_cash('TRIAL',${literal(JSON.stringify(input))}::jsonb)`;
const sql = `begin;\nselect set_config('request.jwt.claim.sub',${literal(cfg.actor)},true);\nset local role authenticated;\nselect ${call};\nselect ${call};\nrollback;\n`;
mkdirSync(resolve(output), { recursive: true, mode: 0o700 });
writeFileSync(resolve(output, "ensayo-caja-rollback.sql"), sql, {
  mode: 0o600,
});
writeFileSync(
  resolve(output, "resumen.json"),
  JSON.stringify(
    {
      synthetic_test_only: true,
      project: cfg.project,
      source_plan_sha256: cfg.plan_sha256,
      total_cents: sum,
      cash_delta_cents: cash,
      change_cents: change,
      commits_payment: false,
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    total_cents: sum,
    cash_delta_cents: cash,
    change_cents: change,
    files: 2,
    commits_payment: false,
  }),
);
