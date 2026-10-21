import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRenewedOpenAccounts } from "./reconcile-customer-pilot.mjs";
import {
  parseLinkedAbonos,
  mxnCents,
  sourceDate,
} from "./prepare-customer-credit.mjs";
export function operatingRenewal(
  source,
  registry,
  accounts,
  details,
  list,
  at,
  pins,
  baseHash,
) {
  const renewal = validateRenewedOpenAccounts(source, accounts, details, at);
  const count = (list.final?.state?.match(/ {4}- button /g) ?? []).length;
  if (
    count !== source.customers.length ||
    list.final.state.includes("progressbar") ||
    !list.final.state.includes("APARTADO") ||
    list.final.state.includes("token a expirado")
  )
    throw Error("RENEWED_LIST_INCOMPLETE");
  const stamps = [
    list.final.captured_at,
    ...accounts.map((a) => a.captured_at),
    ...details.map((d) => d.captured_at),
  ];
  for (const s of stamps)
    if (
      !Number.isFinite(Date.parse(s)) ||
      Date.parse(s) > Date.parse(at) ||
      Date.parse(at) - Date.parse(s) > 86400000
    )
      throw Error("RENEWED_CUT_STALE");
  const rows = source.customers
    .filter((c) => c.used_cents > 0)
    .map((c) => {
      const r = registry.accounts.find(
        (a) => a.customer_key === c.customer_key,
      );
      if (!r) throw Error("REGISTRY_REFERENCE_REQUIRED");
      return {
        registry_id: r.registry_id,
        source_ref: c.source_ref,
        balance_cents: c.used_cents,
        documents: source.documents
          .filter(
            (d) =>
              d.customer_key === c.customer_key &&
              d.financial_status === "OPEN",
          )
          .map((d) => {
            const x = details.find(
              (x) =>
                x.client_ref === c.source_ref && x.folio === d.source_folio,
            );
            if (x.full_reload_before_read !== true)
              throw Error("DOCUMENT_FULL_RELOAD_REQUIRED");
            const due = sourceDate(
              /Venc(?:e|ió) el (\d{2}\/\d{2}\/\d{4})/.exec(x.detail_text)?.[1],
            );
            if (due !== d.due_date) throw Error("RENEWED_DUE_DATE_CHANGED");
            const total = mxnCents(
              /(?:^|\n)MXN (\$[\d,.]+)/.exec(x.detail_text)[1],
            );
            const balance = mxnCents(
              /Saldo (\$[\d,.]+)/.exec(x.detail_text)[1],
            );
            return {
              key: d.document_key,
              folio: d.source_folio,
              source_document_id: d.source_document_id,
              total_cents: total,
              balance_cents: balance,
              paid_cents: total - balance,
              due_date: due,
              payments: parseLinkedAbonos(x)
                .map((p) => ({
                  source_ref: p.source_ref,
                  amount_cents: p.amount_cents,
                  cancelled: p.cancelled,
                }))
                .sort((a, b) => a.source_ref.localeCompare(b.source_ref)),
            };
          })
          .sort((a, b) => a.key.localeCompare(b.key)),
      };
    })
    .sort((a, b) => a.registry_id.localeCompare(b.registry_id));
  return {
    scope: renewal.scope,
    source_batch: registry.batch,
    source_at: new Date(Math.min(...stamps.map(Date.parse))).toISOString(),
    observation_end_at: new Date(
      Math.max(...stamps.map(Date.parse)),
    ).toISOString(),
    base_plan_sha256: baseHash,
    list_evidence_sha256: pins.list,
    accounts_evidence_sha256: pins.accounts,
    documents_evidence_sha256: pins.details,
    list_count: count,
    full_customer_directory: false,
    document_count: renewal.documents,
    balance_cents: rows.reduce((n, a) => n + a.balance_cents, 0),
    active_historical_cents: renewal.active_cents,
    cancelled_excluded_cents: renewal.cancelled_excluded_cents,
    accounts: rows,
  };
}
export function prepareOperating(configPath, out) {
  const cfg = JSON.parse(readFileSync(configPath, "utf8")),
    input = {},
    pins = {};
  for (const k of ["source", "registry", "accounts", "details", "list"]) {
    const pin = cfg.inputs?.[k];
    if (!pin?.path || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? ""))
      throw Error("PIN_REQUIRED:" + k);
    const raw = readFileSync(pin.path);
    if (createHash("sha256").update(raw).digest("hex") !== pin.sha256)
      throw Error("INPUT_CHANGED:" + k);
    input[k] = JSON.parse(raw);
    pins[k] = pin.sha256;
  }
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (
    !uuid.test(cfg.actor ?? "") ||
    !uuid.test(cfg.cut_id ?? "") ||
    !/^[a-f0-9]{64}$/.test(cfg.base_plan_sha256 ?? "") ||
    input.source.project_id !== "zsezjtswqeijboezvado"
  )
    throw Error("EXPLICIT_STAGING_PLAN_REQUIRED");
  const payload = operatingRenewal(
    input.source,
    input.registry,
    input.accounts,
    input.details,
    input.list,
    cfg.assessment_at,
    pins,
    cfg.base_plan_sha256,
  );
  const q = (v) => "'" + String(v).replaceAll("'", "''") + "'";
  const prefix = `begin;\nselect set_config('request.jwt.claim.sub',${q(cfg.actor)},true);\n`;
  const call = `select app.m9_register_operating_cut(${q(cfg.cut_id)},${q(JSON.stringify(payload))}::jsonb);\n`;
  mkdirSync(resolve(out), { recursive: true, mode: 0o700 });
  for (const [file, data] of Object.entries({
    "corte-renovado.json": JSON.stringify(payload, null, 2) + "\n",
    "registro-corte-staging.sql": prefix + call + call + "commit;\n",
    "ensayo-corte-rollback.sql": prefix + call + call + "rollback;\n",
    "resumen.json":
      JSON.stringify(
        {
          accounts: payload.accounts.length,
          documents: payload.document_count,
          source_at: payload.source_at,
          balance_cents: payload.balance_cents,
          operating_enabled: false,
          source_updates: 0,
          full_customer_directory: false,
        },
        null,
        2,
      ) + "\n",
  }))
    writeFileSync(resolve(out, file), data, { mode: 0o600 });
  console.log(
    JSON.stringify({
      accounts: payload.accounts.length,
      documents: payload.document_count,
      balance_cents: payload.balance_cents,
      source_at: payload.source_at,
      operating_enabled: false,
    }),
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [cfg, out] = process.argv.slice(2);
  if (!cfg || !out)
    throw Error("Usage: node prepare-legacy-operating.mjs config output");
  prepareOperating(cfg, out);
}
