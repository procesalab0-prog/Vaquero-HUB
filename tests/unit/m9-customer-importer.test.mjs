import { it, expect } from "vitest";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  sourceImportSQL,
  prepareCustomerSourceImport,
  sourceImportRollbackSQL,
} from "../../scripts/m9/import-customer-sources.mjs";
import {
  sourceImporterRehearsal,
  nativeOpeningRehearsal,
} from "../../scripts/m9/rehearse-customer-import.mjs";
const actor = "2b5e4ba1-00f2-48c7-bbe0-273340629711";
function plan() {
  return {
    version: "m9-customer-credit-1",
    project_id: "zsezjtswqeijboezvado",
    scope: "APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS",
    production_allowed: false,
    operational_import_allowed: false,
    inventory_import_allowed: false,
    customers: [{}],
    documents: [{}],
    payments: [{ cancelled: false }],
    lines: [{}],
    summary: { opening_candidate_cents: 1000 },
  };
}
function fixture() {
  const audit = {};
  for (let i = 0; i < 126; i++)
    audit["app.qa_" + i] = { count: 0, md5: "0".repeat(32) };
  return {
    snapshot: {
      project_id: "zsezjtswqeijboezvado",
      captured_at: "2026-10-20T15:30:00Z",
      audit,
    },
    ctx: {
      actor_id: actor,
      customer_id: "afbb18d6-a2bc-4da7-a261-47a5905bf28c",
      session_id: "69d25da1-1b31-4f94-928f-77ad0708846a",
      location_id: "467765fe-d18e-43bb-be68-326adbf05ce1",
      native_balance_cents: 0,
      privacy_recorded: true,
      phone_e164: "+523521234567",
    },
    variant: {
      barcode: "000012",
      variant_id: "6da4feb2-7146-4d4d-b865-6af14cc02a9b",
    },
  };
}
it("requires an explicit boolean before generating a committed source load", () => {
  const raw = JSON.stringify(plan());
  expect(sourceImportSQL(raw, actor).trim().endsWith("rollback;")).toBe(true);
  expect(
    sourceImportSQL(raw, actor, { commit: true }).trim().endsWith("commit;"),
  ).toBe(true);
  expect(() => sourceImportSQL(raw, actor, { commit: "false" })).toThrow(
    "EXPLICIT_IMPORT_MODE_REQUIRED",
  );
});
it("pins exact UTF-8 plan bytes and escapes SQL data without letting it end the DO body", () => {
  const p = plan();
  p.customers[0] = { source_display_name: "O'Brian \\ literal" };
  const raw = JSON.stringify(p);
  const sql = sourceImportSQL(raw, actor);
  expect(sql).toContain(createHash("sha256").update(raw).digest("hex"));
  expect(sql).toContain("O''Brian");
  expect(sql).toContain("standard_conforming_strings=on");
  p.customers[0].source_display_name = "$import$";
  expect(() => sourceImportSQL(JSON.stringify(p), actor)).toThrow(
    "UNSAFE_DO_DELIMITER",
  );
});
it("rejects production, inventory authorization, unknown versions, scopes or bad actors", () => {
  for (const change of [
    { project_id: "production" },
    { production_allowed: true },
    { inventory_import_allowed: true },
    { operational_import_allowed: true },
    { version: "unknown" },
    { scope: "ALL_UNKNOWN" },
  ])
    expect(() =>
      sourceImportSQL(JSON.stringify({ ...plan(), ...change }), actor),
    ).toThrow("PRIVATE_SOURCE_IMPORT_REQUIRED");
  expect(() => sourceImportSQL(JSON.stringify(plan()), "not uuid")).toThrow(
    "PRIVATE_SOURCE_IMPORT_REQUIRED",
  );
});
it("does not connect or create customers when preparing SQL", () => {
  const sql = sourceImportSQL(JSON.stringify(plan()), actor);
  expect(sql).toContain("app.m9_import_customer_sources");
  expect(sql).not.toMatch(
    /create_customer\(|insert into public\.|create_sale\(|apply_movement\(/,
  );
});
it("provides a source-only removal that preserves audit/native history and defaults to rollback", () => {
  const sql = sourceImportRollbackSQL("a".repeat(64), actor);
  expect(sql.trim().endsWith("rollback;")).toBe(true);
  expect(sql).toContain("M9_SOURCE_BATCH_HAS_NATIVE_HISTORY");
  expect(sql).toContain("m9.customer_sources.remove");
  expect(sql).not.toMatch(/delete from public\.|disable trigger/);
  expect(
    sourceImportRollbackSQL("a".repeat(64), actor, { commit: true })
      .trim()
      .endsWith("commit;"),
  ).toBe(true);
  expect(() => sourceImportRollbackSQL("bad", actor)).toThrow(
    "PRIVATE_SOURCE_ROLLBACK_REQUIRED",
  );
});
it("requires a fresh full staging QA baseline and a consented existing fixture", () => {
  const { snapshot, ctx, variant } = fixture();
  expect(() =>
    nativeOpeningRehearsal(
      { ...snapshot, project_id: "production" },
      ctx,
      variant,
    ),
  ).toThrow();
  expect(() =>
    nativeOpeningRehearsal(
      snapshot,
      { ...ctx, native_balance_cents: 1 },
      variant,
    ),
  ).toThrow();
  expect(() =>
    nativeOpeningRehearsal(
      snapshot,
      { ...ctx, privacy_recorded: false },
      variant,
    ),
  ).toThrow();
  expect(() =>
    nativeOpeningRehearsal(snapshot, { ...ctx, location_id: null }, variant),
  ).toThrow();
});
it("rejects malformed audit identifiers and unpinned barcode targets", () => {
  const { snapshot, ctx, variant } = fixture();
  delete snapshot.audit["app.qa_0"];
  snapshot.audit["app.qa_0;drop"] = { count: 0, md5: "0".repeat(32) };
  expect(() => nativeOpeningRehearsal(snapshot, ctx, variant)).toThrow(
    "CUSTOMER_IMPORT_AUDIT_INVALID",
  );
  const f = fixture();
  expect(() =>
    nativeOpeningRehearsal(f.snapshot, f.ctx, {
      ...variant,
      variant_id: "missing",
    }),
  ).toThrow("QA_EXACT_VARIANT_REQUIRED");
});
it("marks the native source fixture synthetic and tests compensation before and after collection", () => {
  const f = fixture(),
    sql = nativeOpeningRehearsal(f.snapshot, f.ctx, f.variant);
  expect(sql).toContain("SYNTHETIC_QA_NOT_SICAR");
  expect(sql).toContain("M9 QA SIN IDENTIDAD SICAR");
  expect(sql).toContain("app.m9_open_customer_credit");
  expect(sql).toContain("app.m9_reverse_customer_credit");
  expect(sql).toContain("M9_OPENING_HAS_PAYMENTS");
  expect(sql).toContain("REVERSAL_LEFT_FIFO_DEBT");
  expect(sql).toContain("M9_SOURCE_CUT_STALE");
  expect(sql).toContain("M9_SOURCE_CUT_LOCATION_REQUIRED");
  expect(sql).toContain("M9_CUSTOMER_ALREADY_LINKED");
  expect(sql).toContain("app.credit_charge_outstanding");
  expect(sql).not.toContain("insert into public.customers");
  expect(sql.trim().endsWith("rollback;")).toBe(true);
});
it("tests source-money gaps, fake consent, delivery guesses, role denial and replay conflicts", () => {
  const f = fixture(),
    sql = sourceImporterRehearsal(JSON.stringify(plan()), f.snapshot, f.ctx);
  for (const marker of [
    "M9_CUSTOMER_DEBT_MISMATCH",
    "M9_CUSTOMER_IDENTITY_UNREVIEWED",
    "M9_CUSTOMER_ABONO_MISMATCH",
    "PARTIAL_IMPORT_LEFT_BEHIND",
    "set local role anon",
    "set local role authenticated",
    "set local role service_role",
    "M9_CUSTOMER_REPLAY_CONFLICT",
    "unique_violation",
  ])
    expect(sql).toContain(marker);
  expect(sql.trim().endsWith("rollback;")).toBe(true);
});
it("refuses missing source payments or a synthetic batch in the real-source trial", () => {
  const f = fixture();
  expect(() =>
    sourceImporterRehearsal(
      JSON.stringify({ ...plan(), payments: [] }),
      f.snapshot,
      f.ctx,
    ),
  ).toThrow("REAL_SOURCE_TRIAL_REQUIRED");
  expect(() =>
    sourceImporterRehearsal(
      JSON.stringify({ ...plan(), scope: "SYNTHETIC_QA_NOT_SICAR" }),
      f.snapshot,
      f.ctx,
    ),
  ).toThrow("REAL_SOURCE_TRIAL_REQUIRED");
});
it("fails closed before writing an importer package when input pins changed", async () => {
  const p = await mkdtemp(join(tmpdir(), "m9-importer-"));
  try {
    const cfg = join(p, "config.json");
    await writeFile(
      cfg,
      JSON.stringify({
        inputs: { clients: { path: "clients.json", sha256: "0".repeat(64) } },
      }),
    );
    await writeFile(join(p, "clients.json"), "[]");
    await expect(
      prepareCustomerSourceImport(cfg, join(p, "out"), actor),
    ).rejects.toThrow("CUSTOMER_INPUT_CHANGED:clients");
    await expect(
      prepareCustomerSourceImport(cfg, join(p, "bad"), "bad"),
    ).rejects.toThrow("STAGING_ACTOR_REQUIRED");
  } finally {
    await rm(p, { recursive: true, force: true });
  }
});
it("keeps migrations private and leaves native customer constraints untouched", async () => {
  const sql = await readFile(
    new URL(
      "../../supabase/migrations/20261020153451_m9_customer_source_import_staging.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect((sql.match(/enable row level security/g) || []).length).toBe(6);
  expect(sql).toContain("from public,anon,authenticated,service_role");
  expect(sql).toContain("current_user<>'postgres'");
  expect(sql).toContain("r.code='ADMIN'");
  expect(sql).not.toMatch(
    /alter table public\.customers|grant .* to authenticated|security definer/i,
  );
  const correction = await readFile(
    new URL(
      "../../supabase/migrations/20261020154010_m9_customer_opening_location.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(correction).toContain("charge.location_id");
  expect(correction).toContain("'CANCELLATION'");
  expect(correction).toContain(
    "insert into public.customer_credit_allocations",
  );
  expect(correction).not.toMatch(/delete from public\.customer_credit_ledger/i);
});
