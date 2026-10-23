import { it, expect } from "vitest";
import { digest } from "../../scripts/m9/acceleration.mjs";
import {
  prepareArchiveLineLink,
  archiveLineLinkTrialSQL,
  runArchiveLineLink,
} from "../../scripts/m9/clientes-archive-line-link.mjs";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { byteHash } from "../../scripts/m9/clientes-lines-delivery.mjs";
const ref = "11111111-1111-4111-8111-111111111111",
  vid = "22222222-2222-4222-8222-222222222222",
  rev = "33333333-3333-4333-8333-333333333333",
  now = "2026-10-22T23:50:00.000Z",
  sha = "a".repeat(64);
function fixture() {
  const row = {
      barcode: "000123",
      description: "Exact SICAR",
      family_key: "provisional",
    },
    line = {
      index: 0,
      barcode: "000123",
      quantity: "1",
      description: "Old source",
      variant_id: null,
      delivery_status: "UNKNOWN",
      reserved_qty: null,
      stock_deduction: null,
    };
  const doc = {
    key: digest({ tenant: "VSM", client_ref: ref, folio: "VSM1" }),
    folio: "VSM1",
    source_at: "2026-10-22T18:00:00.000Z",
    lines: [line],
    balance_cents: 100,
    paid_cents: 0,
    payments: [],
    source_id: "a".repeat(24),
  };
  const registered = {
    document_key: doc.key,
    line_index: 0,
    barcode: "000123",
    quantity: 1,
    variant_id: null,
    payload: {
      delivery_status: "UNKNOWN",
      reserved_qty: null,
      additional_stock_deduction: null,
    },
  };
  const managed = {
    barcode: "000123",
    variant_id: vid,
    source_row: row,
    source_sha256: sha,
  };
  const match = {
    variant_id: vid,
    product_id: ref,
    active: true,
    primary: true,
    barcode_source: "SICAR",
    managed_barcode: "000123",
    managed_variant_id: vid,
    source_row: row,
    current_row: row,
  };
  return {
    archive: {
      protocol: "m9-credit-detail-archive-1",
      source_plan_sha256: sha,
      source_from: doc.source_at,
      source_until: doc.source_at,
      operational_import_allowed: false,
      accounts: [
        {
          key: digest({ tenant: "VSM", client_ref: ref }),
          ref,
          documents: [doc],
        },
      ],
    },
    sourceRows: [
      {
        row: 2,
        barcode: "000123",
        fields: { "clave1 *": "000123" },
        classification: "SICAR_ONLY",
      },
    ],
    snapshot: {
      protocol: "m9-exact-legacy-lines-snapshot-1",
      project_id: "zsezjtswqeijboezvado",
      captured_at: now,
      archive_sha256: sha,
      archive_payload_hash: sha,
      codes: [
        {
          barcode: "000123",
          registered_documents: [
            {
              document_key: doc.key,
              customer_key: digest({ tenant: "VSM", client_ref: ref }),
              client_ref: ref,
              source_folio: doc.folio,
              source_document_id: doc.source_id,
            },
          ],
          matches: [match],
          managed_rows: [managed],
          registered_lines: [registered],
        },
      ],
    },
    assessed_at: now,
    barcode: "000123",
    request_id: ref,
    revoke_request_id: rev,
  };
}
it("creates one inert overlay request while raw variants remain null", () => {
  const f = fixture(),
    p = prepareArchiveLineLink(f);
  expect(p.planned_overlay_bindings).toBe(1);
  expect(p.effective_identity_candidates_after_review).toBe(1);
  expect(p.payload.variant_id).toBe(vid);
  expect(p.payload.expected_document.lines[0].variant_id).toBeNull();
  expect(p.payload.expected_registered_line.variant_id).toBeNull();
  expect(p.delivery_status).toBe("UNKNOWN");
  expect(p.operational_import_allowed).toBe(false);
});
it("compensates additively using a separate request and next revision", () => {
  const p = prepareArchiveLineLink(fixture());
  expect(p.revoke.request_id).not.toBe(p.payload.request_id);
  expect(p.revoke.revokes_request_id).toBe(p.payload.request_id);
  expect(p.revoke.expected_revision).toBe(1);
  expect(p.revoke.variant_id).toBeNull();
  expect(p.revoke.expected_current_row).toBeNull();
});
it("pins all evidence deterministically", () => {
  const f = fixture();
  expect(prepareArchiveLineLink(f)).toEqual(
    prepareArchiveLineLink(structuredClone(f)),
  );
});
it.each(["project_id", "archive_sha256"])(
  "rejects changed snapshot %s",
  (key) => {
    const f = fixture();
    f.snapshot[key] = "b".repeat(64);
    expect(() => prepareArchiveLineLink(f)).toThrow(
      "PINNED_STAGING_ARCHIVE_REQUIRED",
    );
  },
);
it("rejects stale destination rather than re-dating source", () => {
  const f = fixture();
  f.assessed_at = "2026-10-24T23:50:00.000Z";
  expect(() => prepareArchiveLineLink(f)).toThrow(
    "EXACT_SINGLE_LINE_CANDIDATE_REQUIRED",
  );
});
it("rejects duplicate source literals", () => {
  const f = fixture();
  f.sourceRows.push({ ...f.sourceRows[0], row: 3 });
  expect(() => prepareArchiveLineLink(f)).toThrow(
    "EXACT_SINGLE_LINE_CANDIDATE_REQUIRED",
  );
});
it("rejects multiple source documents with the same code as a single-line request", () => {
  const f = fixture(),
    doc = structuredClone(f.archive.accounts[0].documents[0]);
  doc.folio = "VSM2";
  doc.key = digest({ tenant: "VSM", client_ref: ref, folio: doc.folio });
  f.archive.accounts[0].documents.push(doc);
  expect(() => prepareArchiveLineLink(f)).toThrow(
    "EXACT_SINGLE_LINE_CANDIDATE_REQUIRED",
  );
});
it("rejects duplicate live variants", () => {
  const f = fixture();
  f.snapshot.codes[0].matches.push({ ...f.snapshot.codes[0].matches[0] });
  expect(() => prepareArchiveLineLink(f)).toThrow(
    "EXACT_SINGLE_LINE_CANDIDATE_REQUIRED",
  );
});
it("requires unchanged current managed row", () => {
  const f = fixture();
  f.snapshot.codes[0].matches[0].current_row = {
    ...f.snapshot.codes[0].matches[0].current_row,
    description: "changed",
  };
  expect(() => prepareArchiveLineLink(f)).toThrow(
    "EXACT_SINGLE_LINE_CANDIDATE_REQUIRED",
  );
});
it("rejects an already mapped raw archive", () => {
  const f = fixture();
  f.archive.accounts[0].documents[0].lines[0].variant_id = vid;
  expect(() => prepareArchiveLineLink(f)).toThrow(
    "EXACT_SINGLE_LINE_CANDIDATE_REQUIRED",
  );
});
it.each(["variant_id", "barcode", "quantity"])(
  "requires exact registered line %s",
  (key) => {
    const f = fixture();
    f.snapshot.codes[0].registered_lines[0][key] =
      key === "variant_id" ? vid : key === "quantity" ? 2 : "123";
    expect(() => prepareArchiveLineLink(f)).toThrow("REGISTERED_LINE_DIFFERS");
  },
);
it("requires registered line itself instead of another document with same code", () => {
  const f = fixture();
  f.snapshot.codes[0].registered_lines[0].document_key = "b".repeat(64);
  expect(() => prepareArchiveLineLink(f)).toThrow("REGISTERED_LINE_DIFFERS");
});
it.each(["client_ref", "source_document_id", "source_folio", "customer_key"])(
  "requires exact registered document origin %s",
  (key) => {
    const f = fixture();
    f.snapshot.codes[0].registered_documents[0][key] = "different";
    expect(() => prepareArchiveLineLink(f)).toThrow(
      "REGISTERED_DOCUMENT_ORIGIN_DIFFERS",
    );
  },
);
it("retains unknown physical quantities instead of zero", () => {
  const f = fixture();
  f.snapshot.codes[0].registered_lines[0].payload.additional_stock_deduction = 0;
  expect(() => prepareArchiveLineLink(f)).toThrow("REGISTERED_LINE_DIFFERS");
});
it("rejects a shared bind/revoke request id", () => {
  const f = fixture();
  f.revoke_request_id = f.request_id;
  expect(() => prepareArchiveLineLink(f)).toThrow(
    "LINK_REQUEST_METADATA_INVALID",
  );
});
it("requires PostgreSQL archive hash separately from JS evidence", () => {
  const f = fixture();
  delete f.snapshot.archive_payload_hash;
  expect(() => prepareArchiveLineLink(f)).toThrow("SQL_ARCHIVE_HASH_REQUIRED");
});
it("rehearsal always ends with ROLLBACK and includes additive compensation", () => {
  const sql = archiveLineLinkTrialSQL(prepareArchiveLineLink(fixture()), ref);
  expect(sql).toMatch(/^begin;/);
  expect(sql).toMatch(/rollback;\n$/);
  expect(sql).toContain("app.m9_record_archived_line_link");
  expect(sql).toContain("REVOKED");
  expect(sql).not.toMatch(/update\s+app.m9_credit/i);
});
it("does not permit source text to escape the DO delimiter", () => {
  const p = prepareArchiveLineLink(fixture());
  p.payload.expected_document.lines[0].description = "$m9_line_trial$";
  expect(() => archiveLineLinkTrialSQL(p, ref)).toThrow("UNSAFE_DO_DELIMITER");
});
it("never overwrites an existing dossier", () => {
  const dir = mkdtempSync(join(tmpdir(), "m9-link-exclusive-"));
  try {
    const f = fixture(),
      inputs = {};
    for (const key of ["archive", "sourceRows", "snapshot"]) {
      const path = join(dir, key + ".json");
      writeFileSync(path, JSON.stringify(f[key]));
      inputs[key] = { path, sha256: byteHash(readFileSync(path)) };
    }
    const cfg = join(dir, "config.json");
    writeFileSync(
      cfg,
      JSON.stringify({
        inputs,
        actor_id: ref,
        metadata: {
          assessed_at: now,
          barcode: f.barcode,
          request_id: ref,
          revoke_request_id: rev,
        },
      }),
    );
    const out = join(dir, "first");
    runArchiveLineLink(cfg, out);
    const before = readFileSync(join(out, "payload-vinculo-inerte.json"));
    expect(() => runArchiveLineLink(cfg, out)).toThrow(/EEXIST/);
    expect(readFileSync(join(out, "payload-vinculo-inerte.json"))).toEqual(
      before,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
