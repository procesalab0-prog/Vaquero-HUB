import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ruleCohort, digest } from "../../scripts/m9/acceleration.mjs";
import {
  planPhasedLaunch,
  preparePhasedLaunch,
} from "../../scripts/m9/prepare-phased-launch.mjs";
import { phaseGuardRehearsal } from "../../scripts/m9/phased-guard-rehearsal.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = (barcode, description) => ({
  barcode,
  description,
  classification: "SICAR_ONLY",
  issues: [],
  commercial_checks: [],
  fields: {
    "clave1 *": barcode,
    "descripción *": description,
    departamento: "CABALLERO",
    categoria: "CAMISAS",
    precio1: "740",
    "(s/n) mostrar en ventas": "s",
    unidad: "PIEZA",
    "(s/n) inventariable": "s",
    "(s/n) granel": "n",
    "(s/n) receta": "n",
    "(s/n) lotes": "n",
  },
});
function fixture() {
  const rows = [
    source("0001", "REVISADO"),
    source("2", "MODELOT.S"),
    source("3", "MODELOT.M"),
    source("4", "INDEPENDIENTE"),
    source("5", "RETENIDO"),
    source("6", "SIN CARGAR"),
  ];
  const cohort = ruleCohort({
    rows,
    snapshot: { codes: [], names: [] },
    taxonomy: { paths: [] },
    questions: [],
    sourceSha: "a".repeat(64),
    seed: "launch-test",
  });
  const authorization = {
    authorization: {
      scope: "STAGING_RULE_ONLY",
      authority: "User",
      statement: "Staging rule only",
      date: "2026-10-18",
    },
    sampleReview: {
      kind: "TECHNICAL_SOURCE_REVIEW",
      reviewer: "Codex",
      result: "PASS",
      cohort_sha256: cohort.cohort_sha256,
      sample_sha256: digest(cohort.sample),
    },
  };
  const staged = rows.slice(0, 5).map((s, i) => ({
    barcode: s.barcode,
    variant_id: id(i + 1),
    product_id: id(20 + i),
    current: {
      barcode: s.barcode,
      description: s.description,
      department: "CABALLERO",
      section: "CAMISAS",
      price_cents: 74000,
      cost_cents: null,
      product_name: i === 1 || i === 2 ? "MODELO" : s.description,
      attributes: i === 1 ? { TALLA: "S" } : i === 2 ? { TALLA: "M" } : {},
    },
    stored_matches: true,
    barcode_matches: true,
    allowlisted: i === 0,
    review_matches: i === 0 ? true : null,
    provisional: i === 3 ? "PROVISIONAL" : null,
    web_release: false,
    is_active: true,
    unit_code: "PIECE",
  }));
  return {
    rows,
    snapshot: {
      project_id: "zsezjtswqeijboezvado",
      managed_count: 5,
      captured_at: "2026-10-19T20:00:00Z",
      control: {
        enabled: true,
        review_sha256: "b".repeat(64),
        expires_at: "2026-10-19T19:00:00Z",
      },
      locations: [
        { id: id(100), name: "Tienda", type: "STORE", is_active: true },
        { id: id(101), name: "Tránsito", type: "TRANSIT", is_active: true },
      ],
      operational: {
        sales: 2,
        returns: 1,
        inventory_movements: 8,
        qty: 0,
        reserved_qty: 0,
      },
      rows: staged,
    },
    ruleCohort: cohort,
    ruleAuthorization: authorization,
    sourceCut: {
      sicar_date: "2026-10-12",
      woo_date: "2026-10-12",
      sicar_sha256: "a".repeat(64),
      woo_sha256: "c".repeat(64),
    },
    asOf: "2026-10-19T21:00:00Z",
    batchSize: 1,
  };
}
describe("M9 phased launch preparation", () => {
  function rehearsalFixture() {
    const f = fixture();
    f.snapshot.audit = Object.fromEntries(
      [
        "public.variants",
        "public.products",
        "public.barcodes",
        "public.inventory_by_location",
        "public.inventory_movements",
        "public.sales",
        "public.sale_items",
        "public.sale_payments",
        "public.cash_movements",
        "public.returns",
        "public.return_items",
        "public.return_payments",
        "app.supervisor_authorizations",
        "public.idempotency_keys",
        "public.folios",
        "public.audit_log",
        "app.m9_rehearsal_control",
        "app.m9_rehearsal_allowlist",
      ].map((t) => [t, { count: 0, md5: "d41d8cd98f00b204e9800998ecf8427e" }]),
    );
    return { f, plan: planPhasedLaunch(f) };
  }
  it("generates cumulative rollback-only rehearsals with no operational writer", () => {
    const { f, plan } = rehearsalFixture();
    const sql = phaseGuardRehearsal(plan, f.snapshot, 3);
    expect(sql).toContain("'allowed_in_transaction',4");
    expect(sql.endsWith("rollback;\n")).toBe(true);
    expect(sql).not.toMatch(/\bcommit\s*;/i);
    expect(sql).not.toMatch(
      /apply_inventory_adjustment|create_sale\(|record_return\(|delete from|truncate /i,
    );
    expect(sql).toContain("GUARD_MUST_STAY_ENABLED");
    expect(sql).toContain("OUTSIDE_PHASE_ALLOWED");
    expect(sql).toContain("CLIENT_CAN_ACTIVATE_PHASE");
  });
  it("rejects changed batches, held codes and missing audit history", () => {
    const { f, plan } = rehearsalFixture();
    const changed = structuredClone(plan);
    changed.stages[0].batches[0].codes[0].barcode = "5";
    expect(() => phaseGuardRehearsal(changed, f.snapshot, 1)).toThrow(
      "BATCH_IDENTITY_CHANGED",
    );
    changed.stages[0].batches[0].identity_sha256 = digest(
      changed.stages[0].batches[0].codes,
    );
    expect(() => phaseGuardRehearsal(changed, f.snapshot, 1)).toThrow(
      "HELD_OR_CHANGED_IDENTITY_IN_BATCH",
    );
    delete f.snapshot.audit["public.audit_log"];
    expect(() => phaseGuardRehearsal(plan, f.snapshot, 1)).toThrow(
      "FULL_AUDIT_BASELINE_REQUIRED",
    );
  });
  it("cannot generate an activation rehearsal for production or an importable plan", () => {
    const { f, plan } = rehearsalFixture();
    plan.production_allowed = true;
    expect(() => phaseGuardRehearsal(plan, f.snapshot, 1)).toThrow(
      "READ_ONLY_STAGING_PLAN_REQUIRED",
    );
    plan.production_allowed = false;
    f.snapshot.project_id = "other";
    expect(() => phaseGuardRehearsal(plan, f.snapshot, 1)).toThrow(
      "READ_ONLY_STAGING_PLAN_REQUIRED",
    );
  });
  it("partitions every literal source code once, preserving history and keeping authorization false", () => {
    const f = fixture(),
      p = planPhasedLaunch(f);
    expect(p.summary.stages).toEqual({
      HELD: 2,
      PROVISIONAL: 1,
      REVIEWED: 1,
      RULE_T: 2,
    });
    expect(p.summary.held_loaded).toBe(1);
    expect(p.summary.not_loaded).toBe(1);
    expect(p.operational_baseline).toEqual(f.snapshot.operational);
    expect(p.production_allowed).toBe(false);
    expect(p.review_lease_current).toBe(false);
    expect(
      p.stages
        .flatMap((s) => s.batches)
        .flatMap((b) => b.codes)
        .map((r) => r.barcode),
    ).toEqual(["0001", "2", "3", "4"]);
    expect(
      p.ledger.every(
        (r) =>
          !r.live_sale_authorized &&
          !r.woo_release_authorized &&
          r.stock_quantity === null,
      ),
    ).toBe(true);
    expect(new Set(p.ledger.map((r) => r.barcode)).size).toBe(f.rows.length);
  });
  it("does not infer quantities, reserves, costs or scope from an empty balance", () => {
    const p = planPhasedLaunch(fixture());
    expect(p.stock_template.rows).toHaveLength(4);
    expect(
      p.stock_template.rows.every(
        (r) =>
          r.quantity === null &&
          r.reserved_quantity === null &&
          r.evidence_sha256 === null &&
          !r.import_allowed,
      ),
    ).toBe(true);
    expect(p.stock_template.missing_means_zero).toBe(false);
    expect(p.stock_template.location_scope_complete).toBe(false);
    expect(p.ledger.every((r) => r.unknown_cost_cents === null)).toBe(true);
  });
  it.each([
    "project",
    "partial",
    "disabled",
    "stale",
    "future",
    "duplicateID",
    "numericCode",
  ])("rejects an unsafe capture: %s", (kind) => {
    const f = fixture();
    if (kind === "project") f.snapshot.project_id = "production";
    if (kind === "partial") f.snapshot.managed_count++;
    if (kind === "disabled") f.snapshot.control.enabled = false;
    if (kind === "stale") f.asOf = "2026-10-21T21:00:00Z";
    if (kind === "future") f.snapshot.captured_at = "2026-10-20T00:00:00Z";
    if (kind === "duplicateID")
      f.snapshot.rows[1].variant_id = f.snapshot.rows[0].variant_id;
    if (kind === "numericCode") f.rows[0].barcode = 1;
    expect(() => planPhasedLaunch(f)).toThrow();
  });
  it("holds changed price, classification, inactive, altered review and barcode bindings without overwriting", () => {
    for (const [key, value] of [
      ["stored_matches", false],
      ["barcode_matches", false],
      ["review_matches", false],
      ["is_active", false],
      ["unit_code", "PAIR"],
    ]) {
      const f = fixture();
      f.snapshot.rows[0][key] = value;
      const p = planPhasedLaunch(f);
      expect(p.ledger[0].stage).toBe("HELD");
    }
    const f = fixture();
    f.snapshot.rows[0].current.price_cents = 74001;
    expect(planPhasedLaunch(f).ledger[0].reasons).toContain(
      "SOURCE_DESTINATION_DIFF:price_cents",
    );
  });
  it("holds a complete rule family when one destination member is edited", () => {
    const f = fixture();
    f.snapshot.rows[1].current.attributes.TALLA = "XL";
    const p = planPhasedLaunch(f);
    expect(
      p.ledger.filter((r) => r.rule_family).every((r) => r.stage === "HELD"),
    ).toBe(true);
    expect(p.ledger.find((r) => r.barcode === "3").reasons).toContain(
      "RULE_FAMILY_NOT_READY",
    );
  });
  it("does not reuse a rule authorization for a changed source or sample", () => {
    const f = fixture();
    f.rows[0].fields.precio1 = "800";
    expect(() => planPhasedLaunch(f)).toThrow("RULE_SOURCE_CUT_CHANGED");
    const g = fixture();
    g.ruleAuthorization.sampleReview.sample_sha256 = "d".repeat(64);
    expect(() => planPhasedLaunch(g)).toThrow("SAMPLE_REVIEW_REQUIRED");
  });
  it("keeps absent destination codes and never proposes deleting or archiving", () => {
    const f = fixture(),
      r = structuredClone(f.snapshot.rows[0]);
    r.barcode = "orphan";
    r.current.barcode = "orphan";
    r.variant_id = id(200);
    f.snapshot.rows.push(r);
    f.snapshot.managed_count++;
    const p = planPhasedLaunch(f);
    expect(p.orphans).toEqual([
      {
        barcode: "orphan",
        variant_id: id(200),
        state: "ABSENT_SOURCE_KEEP_AND_REVIEW",
        delete_allowed: false,
      },
    ]);
    expect(p.archive_allowed).toBe(false);
  });
  it("provisional web release and changed operating modes require review", () => {
    const f = fixture();
    f.snapshot.rows[3].web_release = true;
    expect(
      planPhasedLaunch(f).ledger.find((r) => r.barcode === "4").stage,
    ).toBe("HELD");
    const g = fixture();
    g.rows[0].fields["(s/n) mostrar en ventas"] = "n";
    // Changing the source requires a new, matching rule decision first.
    expect(() => planPhasedLaunch(g)).toThrow("RULE_SOURCE_CUT_CHANGED");
  });
  it("writes identical pinned packets twice, escapes HTML and refuses overwrite/tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "m9-launch-"));
    try {
      const f = fixture();
      f.snapshot.locations[0].name = "<script>";
      const inputs = {};
      for (const name of [
        "rows",
        "snapshot",
        "ruleCohort",
        "ruleAuthorization",
        "manifest",
      ]) {
        const value =
          name === "manifest"
            ? {
                sicar_sha256: f.sourceCut.sicar_sha256,
                woo_sha256: f.sourceCut.woo_sha256,
              }
            : f[name];
        const raw = JSON.stringify(value);
        await writeFile(join(root, name + ".json"), raw);
        inputs[name] = {
          path: name + ".json",
          sha256: createHash("sha256").update(raw).digest("hex"),
        };
      }
      const config = join(root, "config.json");
      await writeFile(
        config,
        JSON.stringify({
          inputs,
          sourceCut: f.sourceCut,
          asOf: f.asOf,
          batchSize: 2,
        }),
      );
      await preparePhasedLaunch(config, join(root, "one"));
      await preparePhasedLaunch(config, join(root, "two"));
      const hashes = JSON.parse(await readFile(join(root, "one/sha256.json")));
      expect(await readFile(join(root, "two/sha256.json"), "utf8")).toBe(
        await readFile(join(root, "one/sha256.json"), "utf8"),
      );
      for (const name of Object.keys(hashes))
        expect(await readFile(join(root, "one", name), "utf8")).toBe(
          await readFile(join(root, "two", name), "utf8"),
        );
      expect(
        await readFile(join(root, "one/reporte.html"), "utf8"),
      ).not.toContain("<script>");
      await expect(
        preparePhasedLaunch(config, join(root, "one")),
      ).rejects.toThrow("EEXIST");
      await writeFile(join(root, "snapshot.json"), "{}");
      await expect(
        preparePhasedLaunch(config, join(root, "three")),
      ).rejects.toThrow("INPUT_CHANGED:snapshot");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
