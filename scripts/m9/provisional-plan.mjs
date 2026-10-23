import { createHash } from "node:crypto";
import { prepareSicarBatches } from "./plan-sicar-only.mjs";
import { digest } from "./acceleration.mjs";
const json = (v) => JSON.stringify(v, null, 2) + "\n";
const hash = (v) => createHash("sha256").update(v).digest("hex");
const valid = (s, n) =>
  typeof s === "string" && s.length > 0 && s.length <= n && s === s.trim();
function cents(s) {
  if (typeof s !== "string" || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const v = BigInt(w) * 100n + BigInt(f.padEnd(2, "0"));
  return v > 0n && v <= 100000000n ? Number(v) : null;
}
// Identity = literal SICAR barcode. Woo/model ambiguity is retained as evidence,
// never resolved or turned into a remote ID by this independent import path.
export function provisionalPlan({
  rows,
  snapshot,
  taxonomy,
  sourceSha,
  authorization,
  date,
}) {
  if (
    !valid(authorization, 2000) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^[a-f0-9]{64}$/.test(sourceSha)
  )
    throw Error("PROVISIONAL_AUTHORIZATION_REQUIRED");
  const seen = new Set(),
    staged = new Set(snapshot.codes.map((x) => x.barcode));
  const taxHeld = new Set(
    taxonomy.paths.filter((x) => x.needs_review).flatMap((x) => x.barcodes),
  );
  const records = [],
    decisions = [],
    sourceEvidence = [],
    held = [];
  for (const r of rows) {
    const f = r.fields;
    if (
      !valid(r.barcode, 80) ||
      seen.has(r.barcode) ||
      f?.["clave1 *"] !== r.barcode ||
      f?.["descripción *"] !== r.description
    )
      throw Error("SOURCE_LITERAL_IDENTITY_CHANGED");
    seen.add(r.barcode);
    if (staged.has(r.barcode)) continue;
    const reasons = [],
      price = cents(f.precio1);
    if (!valid(r.description, 2000)) reasons.push("DESCRIPTION_INVALID");
    if (price === null) reasons.push("PUBLIC_PRICE_INVALID");
    if (
      [f.departamento, f.categoria].some(
        (s) => !valid(s, 2000) || /^(D1|C1|\.|SIN DEFINIR)$/i.test(s),
      ) ||
      taxHeld.has(r.barcode)
    )
      reasons.push("TAXONOMY_REVIEW");
    if (
      r.display_only ||
      /MUESTRA/i.test(r.description) ||
      f["(s/n) mostrar en ventas"] !== "s"
    )
      reasons.push("DISPLAY_OR_SALES_RESTRICTION");
    if (
      f.unidad !== "PIEZA" ||
      f["(s/n) inventariable"] !== "s" ||
      ["(s/n) granel", "(s/n) receta", "(s/n) lotes"].some((k) => f[k] !== "n")
    )
      reasons.push("UNSUPPORTED_OPERATING_MODE");
    const name = r.description + " [SICAR " + r.barcode + "]";
    if (!valid(name, 160)) reasons.push("PRESENTATION_NAME_LIMIT");
    if (snapshot.names.includes(name)) reasons.push("DESTINATION_NAME_REVIEW");
    if (
      (snapshot.categories ?? []).some(
        (c) =>
          c.name.trim().toLowerCase() === f.categoria?.toLowerCase() &&
          (c.name !== f.categoria || !c.is_active),
      )
    )
      reasons.push("CATEGORY_CONFLICT");
    if (reasons.length) {
      held.push({ barcode: r.barcode, reasons });
      continue;
    }
    const evidence = {
      barcode: r.barcode,
      description: r.description,
      department: f.departamento,
      section: f.categoria,
      retail_source: f.precio1,
      sales_visibility: f["(s/n) mostrar en ventas"],
    };
    const record = {
      ...evidence,
      retail_cents: price,
      evidence_sha256: hash(json(evidence)),
      issues: [],
    };
    records.push(record);
    sourceEvidence.push({
      barcode: r.barcode,
      fields: f,
      original_classification: r.classification,
      match_issues: [...(r.issues ?? []), ...(r.commercial_checks ?? [])],
      candidate_woo_ids: r.candidate_product_ids ?? [],
      grouping_status: "PROVISIONAL",
      web_release: false,
    });
    const family_key = "prov-" + hash(r.barcode).slice(0, 40);
    // Standard evidenceFor uses the complete review record projection.
    const evidence_sha256 = hash(
      json([
        [
          record.barcode,
          record.evidence_sha256,
          record.description,
          record.department,
          record.section,
          record.retail_cents,
          [],
        ],
      ]),
    );
    decisions.push({
      family_key,
      product_name: name,
      evidence_sha256,
      members: [{ barcode: r.barcode, attributes: {} }],
      status: "approved",
      reviewer: "Codex · provisional SICAR literal",
      reviewed_at: date,
      reason:
        "STAGING_PROVISIONAL_ONLY; authority: " +
        authorization +
        "; no model/Woo association approved; code=" +
        r.barcode,
    });
  }
  const review = {
    version: "m9-sicar-only-review-1",
    sources: { sicar_sha256: sourceSha, rows_sha256: digest(rows) },
    records,
  };
  const batches = prepareSicarBatches(review, decisions, 100);
  return {
    version: "m9-provisional-plan-1",
    source_sha256: sourceSha,
    source_rows_sha256: digest(rows),
    destination_sha256: digest(snapshot),
    summary: {
      pending: records.length + held.length,
      eligible_codes: records.length,
      held_codes: held.length,
    },
    review,
    decisions,
    batches,
    sourceEvidence,
    held,
    write_allowed: false,
    production_allowed: false,
    inventory_operations: 0,
  };
}
