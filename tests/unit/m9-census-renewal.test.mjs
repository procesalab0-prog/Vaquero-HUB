import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { digest } from "../../scripts/m9/acceleration.mjs";
import {
  generalCustomerRenewal,
  censusRenewalDelta,
  prepareGeneralCustomers,
  censusCanonicalUTC,
} from "../../scripts/m9/prepare-general-customers.mjs";
import {
  censusRenewalArchive,
  prepareCensusArchive,
} from "../../scripts/m9/archive-general-census.mjs";
const old = "2026-10-21T14:00:00.000Z",
  stamp = "2026-10-22T14:00:00.000Z",
  at = "2026-10-22T15:00:00.000Z",
  hash = "a".repeat(64),
  ref = (n) => `00000000-5555-4555-8555-${String(n).padStart(12, "0")}`,
  key = (n) => digest({ tenant: "VSM", client_ref: ref(n) }),
  dk = (n) => digest({ tenant: "VSM", client_ref: ref(n), folio: "148" }),
  sha = (s) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const prior = {
    protocol: "m9-census-archive-1",
    source_plan_sha256: hash,
    source_at: old,
    observed_until: old,
    scope: "VISIBLE_CUSTOMERS_UNPAID_ROWS_ONLY",
    accounts: [1, 2, 3].map((n) => ({
      key: key(n),
      ref: ref(n),
      name: n === 1 ? "QA OLD" : "QA SAME",
      used_cents: n === 3 ? 0 : 1000,
      previously_registered: n === 1,
      documents:
        n === 3
          ? []
          : [
              {
                key: dk(n),
                folio: "148",
                total_cents: 1000,
                balance_cents: 1000,
                occurred_label: "10/20/2026 10:00:00 AM",
                evidence_sha256: hash,
              },
            ],
    })),
  };
  const registry = {
    version: "m9-census-registry-context-1",
    project_id: "zsezjtswqeijboezvado",
    registry_count: 1,
    registry_sha256: hash,
    registered_accounts: [{ key: key(1), ref: ref(1) }],
    prior_archive: {
      source_plan_sha256: hash,
      payload_hash: hash,
      source_at: old,
      observed_until: old,
    },
  };
  const rows = [
      { n: 1, name: "QA RENAMED", amount: 800 },
      { n: 2, name: "QA SAME", amount: 1000 },
      { n: 4, name: "QA SAME", amount: 300 },
    ],
    money = (n) => "$" + (n / 100).toFixed(2);
  const list = {
    captured_at: stamp,
    state: '- combobox "Buscar"\n- button "0":\n',
    rows: rows.map((x, i) => ({
      list_index: i,
      paragraphs: ["", x.name],
      text: x.name + " " + money(x.amount),
    })),
  };
  const captures = rows.map((x, i) => ({
    list_index: i,
    name: x.name,
    client_ref: ref(x.n),
    url: "https://app.sicarx.com/clients/detail/" + ref(x.n),
    full_reload_before_read: true,
    captured_at: stamp,
    credit:
      x.name +
      "\n    - text: Saldo utilizado\n    - paragraph: " +
      money(x.amount) +
      "\n    - text: Saldo vencido\n    - paragraph: $0.00" +
      `\n        - row "10/20/2026 10:00:00 AM 148 $10.00 MXN ${money(x.amount)}":\n          - cell:\n            - paragraph: 10/20/2026 10:00:00 AM\n            - button "148":\n          - cell:\n            - paragraph: $10.00 MXN\n            - paragraph: ${money(x.amount)}`,
    rows: ["$10.00 MXN " + money(x.amount)],
  }));
  return {
    list,
    captures,
    prior,
    registry,
    evidence: {
      list_sha256: hash,
      accounts_sha256: hash,
      prior_payload_sha256: hash,
      registry_snapshot_sha256: hash,
    },
  };
}
const run = (f) =>
  generalCustomerRenewal(
    f.list,
    f.captures,
    f.prior,
    f.registry,
    at,
    f.evidence,
  );
describe("historical census renewal without financial activation", () => {
  it("keeps prior membership independent from live registration", () => {
    const f = fixture(),
      p = run(f);
    expect(p.accounts.find((a) => a.source_ref === ref(2))).toMatchObject({
      present_in_prior_census: true,
      previously_registered: false,
    });
    expect(p.summary).toMatchObject({
      prior_census_members: 2,
      previous_accounts_present: 1,
      new_source_accounts: 2,
    });
    expect(f.prior.accounts[0].previously_registered).toBe(true);
  });
  it("records missing keys without creating a zero or deleting anything", () => {
    const p = run(fixture());
    expect(p.delta.missing_from_visible_scope).toEqual([key(3)]);
    expect(p.accounts.some((a) => a.source_ref === ref(3))).toBe(false);
    expect(p.delta.added_keys).toEqual([key(4)]);
    expect(p.operational_import_allowed).toBe(false);
  });
  it("does not infer liquidation for an absent account that had positive debt", () => {
    const f = fixture();
    f.prior.accounts[2].used_cents = 400;
    f.prior.accounts[2].documents = [
      {
        key: dk(3),
        folio: "148",
        total_cents: 1000,
        balance_cents: 400,
        occurred_label: "10/20/2026 10:00:00 AM",
        evidence_sha256: hash,
      },
    ];
    const p = run(f);
    expect(p.delta.missing_from_visible_scope).toContain(key(3));
    expect(p.accounts.some((a) => a.source_ref === ref(3))).toBe(false);
    expect(f.prior.accounts[2].used_cents).toBe(400);
  });
  it("retains coherent balance/document/name changes only for archival review", () => {
    const p = run(fixture());
    expect(p.archive_eligible).toBe(true);
    expect(p.delta.balance_changed_keys).toEqual([key(1)]);
    expect(p.delta.documents_changed_keys).toEqual([key(1)]);
    expect(p.accounts[0].holds).toEqual([
      "PREVIOUS_BALANCE_CHANGED",
      "PREVIOUS_DOCUMENTS_CHANGED",
      "PRIOR_NAME_CHANGED",
    ]);
    const payload = censusRenewalArchive(p, hash, at);
    expect(payload.archive_only).toBe(true);
    expect(payload.operational_import_allowed).toBe(false);
    expect(payload.accounts.find((a) => a.ref === ref(1)).used_cents).toBe(800);
  });
  it("does not turn absent used balance into zero or accept incoherent archival", () => {
    const f = fixture();
    f.captures[0].credit = f.captures[0].credit.replace(
      "    - text: Saldo utilizado\n    - paragraph: $8.00",
      "    - generic: Saldo utilizado",
    );
    const p = run(f);
    expect(p.accounts[0].used_cents).toBeNull();
    expect(p.archive_eligible).toBe(false);
    expect(() => censusRenewalArchive(p, hash, at)).toThrow();
  });
  it("holds disagreement within the same capture", () => {
    const f = fixture();
    f.list.rows[0].text = "QA RENAMED $9.00";
    const p = run(f);
    expect(p.accounts[0].holds).toContain("LIST_BALANCE_CHANGED");
    expect(p.archive_eligible).toBe(false);
  });
  it.each(["$10.00 MXN$8.00", "$10.00 $8.00 MXN"])(
    "accepts explicit MXN at a textContent boundary: %s",
    (row) => {
      const f = fixture();
      f.captures[0].rows[0] = row;
      expect(run(f).archive_eligible).toBe(true);
    },
  );
  it("holds overdue greater than explicit used balance", () => {
    const f = fixture();
    f.captures[0].credit = f.captures[0].credit.replace(
      "Saldo vencido\n    - paragraph: $0.00",
      "Saldo vencido\n    - paragraph: $9.00",
    );
    const p = run(f);
    expect(p.archive_eligible).toBe(false);
    expect(p.accounts[0].holds).toContain("OVERDUE_EXCEEDS_USED");
    expect(() => censusRenewalArchive(p, hash, at)).toThrow();
  });
  it("preserves duplicate names and same folio across distinct UUIDs", () => {
    const p = run(fixture()),
      payload = censusRenewalArchive(p, hash, at);
    expect(new Set(payload.accounts.map((a) => a.key)).size).toBe(3);
    expect(
      new Set(payload.accounts.flatMap((a) => a.documents.map((d) => d.key)))
        .size,
    ).toBe(3);
    expect(
      p.accounts
        .filter((a) => a.name === "QA SAME")
        .every((a) => a.holds.includes("DUPLICATE_NAME_NOT_MERGED")),
    ).toBe(true);
  });
  it("ignores evidence-byte drift as a financial change, but detects totals and dates", () => {
    const f = fixture(),
      current = structuredClone(f.prior.accounts);
    current[0].documents[0].evidence_sha256 = "b".repeat(64);
    expect(censusRenewalDelta(f.prior, current).documents_changed_keys).toEqual(
      [],
    );
    current[0].documents[0].total_cents = 1200;
    expect(censusRenewalDelta(f.prior, current).documents_changed_keys).toEqual(
      [key(1)],
    );
  });
  it.each([
    "2026-02-31T00:00:00.000Z",
    "2026-10-22T00:00:00Z",
    "2026-10-22T00:00:00.000+00:00",
    "bad",
  ])("rejects noncanonical UTC %s", (value) =>
    expect(() => censusCanonicalUTC(value)).toThrow(),
  );
  it.each([
    (f) => (f.registry.registry_count = 2),
    (f) =>
      f.registry.registered_accounts.push(f.registry.registered_accounts[0]),
    (f) => (f.registry.registered_accounts[0].ref = "wrong"),
    (f) => (f.registry.project_id = "production"),
    (f) => (f.prior.source_plan_sha256 = "b".repeat(64)),
    (f) => (f.captures[0].full_reload_before_read = false),
    (f) => f.captures.pop(),
    (f) => (f.list.state += "progressbar"),
    (f) => (f.captures[0].rows[0] = "$10.00 MXN $8.00 USD"),
    (f) => (f.captures[0].rows[0] = "$10.00 MXNunknown $8.00"),
  ])("rejects invalid source/registry context %#", (change) => {
    const f = fixture();
    change(f);
    expect(() => run(f)).toThrow();
  });
  it.each([
    (p) => (p.operational_import_allowed = true),
    (p) => (p.accounts[0].new_credit_authorized = true),
    (p) => (p.accounts[0].used_cents = null),
    (p) => (p.accounts[0].overdue_cents = p.accounts[0].used_cents + 1),
    (p) => (p.accounts[0].documents[0].delivery_status = "DELIVERED"),
    (p) => (p.accounts[0].documents[0].source_document_id = "invented"),
    (p) => (p.accounts[0].documents[0].balance_cents += 1),
    (p) => p.accounts[0].holds.push("APPROVED"),
    (p) => (p.summary.open_documents += 1),
    (p) => (p.evidence.accounts_sha256 = "wrong"),
  ])("refuses unsafe or incoherent payload %#", (change) => {
    const p = run(fixture());
    change(p);
    expect(() => censusRenewalArchive(p, hash, at)).toThrow();
  });
  it("reproduces new pinned expedients and refuses overwrites", () => {
    const f = fixture(),
      dir = mkdtempSync(join(tmpdir(), "m9-census-renewal-"));
    try {
      const inputs = {};
      for (const [k, v] of Object.entries({
        list: f.list,
        accounts: f.captures,
        prior: f.prior,
        registry: f.registry,
      })) {
        const raw = JSON.stringify(v),
          path = join(dir, k + ".json");
        writeFileSync(path, raw);
        inputs[k] = { path, sha256: sha(raw) };
      }
      const config = join(dir, "config.json");
      writeFileSync(
        config,
        JSON.stringify({
          mode: "RENEWAL_ARCHIVE_ONLY",
          assessment_at: at,
          inputs,
        }),
      );
      prepareGeneralCustomers(config, join(dir, "one"));
      prepareGeneralCustomers(config, join(dir, "two"));
      for (const name of [
        "plan-lectura.json",
        "delta.json",
        "resumen.json",
        "cola-detalles.json",
        "reporte.html",
      ])
        expect(readFileSync(join(dir, "one", name), "utf8")).toBe(
          readFileSync(join(dir, "two", name), "utf8"),
        );
      expect(() => prepareGeneralCustomers(config, join(dir, "one"))).toThrow();
      const planPath = join(dir, "one/plan-lectura.json"),
        planSha = sha(readFileSync(planPath));
      prepareCensusArchive(planPath, planSha, join(dir, "archive1"), at);
      prepareCensusArchive(planPath, planSha, join(dir, "archive2"), at);
      for (const name of ["payload.json", "ensayo.sql", "carga-staging.sql"])
        expect(readFileSync(join(dir, "archive1", name), "utf8")).toBe(
          readFileSync(join(dir, "archive2", name), "utf8"),
        );
      expect(readFileSync(join(dir, "archive1/ensayo.sql"), "utf8")).toContain(
        "rollback;",
      );
      writeFileSync(inputs.accounts.path, "[]");
      expect(() =>
        prepareGeneralCustomers(config, join(dir, "changed")),
      ).toThrow("INPUT_CHANGED:accounts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
