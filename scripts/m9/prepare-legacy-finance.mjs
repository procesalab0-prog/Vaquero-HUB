import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const [configPath, output] = process.argv.slice(2);
if (!configPath || !output)
  throw Error("Usage: node prepare-legacy-finance.mjs config.json output");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const raw = readFileSync(config.plan_path);
const sha = createHash("sha256").update(raw).digest("hex");
if (sha !== config.plan_sha256) throw Error("PLAN_PIN_MISMATCH");
const plan = JSON.parse(raw);
if (
  plan.scope !== "APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS" ||
  !/^[a-f0-9]{64}$/.test(plan.batch)
)
  throw Error("SOURCE_SCOPE_REQUIRED");
const uu = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
for (const key of ["actor", "request", "location", "reverse_request"])
  if (!uu.test(config[key] ?? "")) throw Error("EXPLICIT_UUID_REQUIRED:" + key);
const ids = new Set();
const docs = new Set();
let amount = 0,
  count = 0;
for (const a of plan.accounts) {
  if (!uu.test(a.registry_id) || ids.has(a.registry_id))
    throw Error("ACCOUNT_ID_INVALID");
  ids.add(a.registry_id);
  for (const d of a.documents.filter((d) => d.status === "OPEN")) {
    if (
      docs.has(d.key) ||
      !Number.isSafeInteger(d.balance) ||
      d.balance <= 0 ||
      d.total !== d.paid + d.balance
    )
      throw Error("DOCUMENT_RECONCILIATION_REQUIRED");
    docs.add(d.key);
    const paid = a.payments
      .filter((p) => p.document_key === d.key && !p.cancelled)
      .reduce((n, p) => n + p.amount_cents, 0);
    if (paid !== d.paid) throw Error("HISTORICAL_PAYMENT_MISMATCH");
    amount += d.balance;
    count++;
  }
}
if (
  amount !== plan.amount_cents ||
  count !== plan.document_count ||
  count === 0
)
  throw Error("PLAN_TOTAL_MISMATCH");
const literal = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const call = `app.m9_open_legacy_finance(${literal(config.request)},${literal(plan.batch)},${literal(config.location)},${literal(JSON.stringify(plan))}::jsonb)`;
const prefix = `begin;\nselect set_config('request.jwt.claim.sub',${literal(config.actor)},true);\n`;
const replay = `select ${call};\nselect ${call};\n`;
const reverse = `select app.m9_reverse_legacy_finance(${literal(config.reverse_request)},${literal(config.request)},'Ensayo técnico de compensación antes de cobrar');\n`;
mkdirSync(resolve(output), { recursive: true, mode: 0o700 });
for (const [file, body] of Object.entries({
  "apertura-staging.sql": prefix + replay + "commit;\n",
  "ensayo-compensacion.sql": prefix + replay + reverse + "rollback;\n",
  "resumen.json":
    JSON.stringify(
      {
        plan_sha256: sha,
        batch: plan.batch,
        accounts: ids.size,
        documents: count,
        amount_cents: amount,
        cash_effect_cents: 0,
        inventory_effect: 0,
        staging_only: true,
      },
      null,
      2,
    ) + "\n",
}))
  writeFileSync(resolve(output, file), body, { mode: 0o600 });
console.log(
  JSON.stringify({
    accounts: ids.size,
    documents: count,
    amount_cents: amount,
    files: 3,
  }),
);
