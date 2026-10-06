import { hash, stable } from "../woo-test/plan.mjs";
import { TEST_ORIGIN } from "./client.mjs";
import displayPolicies from "../../../lib/m9-display-policy.json" with { type: "json" };

const uuid = (v) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const text = (v) => typeof v === "string" && v.length > 0 && v === v.trim();
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const unique = (values) => new Set(values).size === values.length;
const attrs = (row) =>
  Object.fromEntries(
    (row.attributes ?? []).map((a) => [
      { Talla: "TALLA", Color: "COLOR", Largo: "LARGO" }[a.name] ?? a.name,
      a.value,
    ]),
  );
function cents(value) {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value))
    return null;
  const [whole, fraction = ""] = value.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(n) && n <= 100000000 ? n : null;
}

// A read-only prerequisite for a future remote family adapter, NOT a dispatch
// packet. Source Woo IDs are evidence only; they must never become test IDs.
export function reviewRemoteFamilies(snapshot, latestRows) {
  if (
    snapshot?.project_id !== "zsezjtswqeijboezvado" ||
    !Array.isArray(snapshot.rows) ||
    !Array.isArray(latestRows) ||
    !unique(snapshot.rows.map((r) => r.product_id))
  )
    throw new Error("STAGING_SNAPSHOT_REQUIRED");
  const codes = new Map();
  for (const r of latestRows) {
    if (!text(r.barcode) || !r.fields) throw new Error("INVALID_SICAR_ROW");
    codes.set(r.barcode, [...(codes.get(r.barcode) ?? []), r]);
  }
  const stagedCodes = new Map();
  for (const r of snapshot.rows)
    for (const v of r.catalog?.variants ?? [])
      stagedCodes.set(v.barcode, (stagedCodes.get(v.barcode) ?? 0) + 1);
  const families = snapshot.rows
    .map((r) => {
      const issues = new Set(),
        changes = [];
      const flag = (ok, reason) => {
        if (!ok) issues.add(reason);
      };
      const c = r.catalog,
        s = r.source,
        d = r.content;
      if (!c || !s || !d || !Array.isArray(c.variants))
        throw new Error("INCOMPLETE_STAGING_ROW");
      flag(
        uuid(r.product_id) &&
          c.product_id === r.product_id &&
          c.active === true,
        "PRODUCT_IDENTITY_REVIEW",
      );
      flag(positive(r.revision), "SAVED_DRAFT_REQUIRED");
      flag(["simple", "variable"].includes(s.type), "PRODUCT_TYPE_REVIEW");
      flag(
        c.variants.length >= 1 && c.variants.length <= 100,
        "VARIANT_COUNT_REVIEW",
      );
      flag(unique(c.variants.map((v) => v.id)), "DUPLICATE_VARIANT_ID");
      flag(
        unique(c.variants.map((v) => stable(v.attributes))),
        "DUPLICATE_ATTRIBUTE_COMBINATION",
      );
      flag(
        c.variants.every(
          (v) =>
            stable(Object.keys(v.attributes ?? {}).sort()) ===
            stable(Object.keys(c.variants[0]?.attributes ?? {}).sort()),
        ),
        "INCONSISTENT_ATTRIBUTE_KEYS",
      );
      const variants = c.variants.map((v) => {
        flag(
          uuid(v.id) &&
            v.active === true &&
            text(v.barcode) &&
            v.barcode.length <= 100,
          "VARIANT_IDENTITY_REVIEW",
        );
        flag(stagedCodes.get(v.barcode) === 1, "DUPLICATE_BARCODE");
        flag(
          Number.isSafeInteger(v.price_cents) &&
            v.price_cents >= 0 &&
            v.price_cents <= 100000000,
          "PRICE_REVIEW",
        );
        flag(v.woo_product_id === s.woo_product_id, "SOURCE_PARENT_MISMATCH");
        flag(
          v.attributes &&
            Object.entries(v.attributes).every(
              ([k, value]) => text(k) && text(value),
            ),
          "ATTRIBUTES_REVIEW",
        );
        const candidates = codes.get(v.barcode) ?? [];
        flag(
          candidates.length === 1,
          candidates.length
            ? "SICAR_DUPLICATE_BARCODE"
            : "SICAR_ABSENT_NO_DELETE",
        );
        if (candidates.length === 1) {
          const latest = candidates[0];
          flag(
            latest.fields["clave1 *"] === v.barcode,
            "SICAR_LITERAL_CODE_MISMATCH",
          );
          const expected = {
            department: latest.fields.departamento,
            section: latest.fields.categoria,
            price_cents: cents(latest.fields.precio1),
            attributes: attrs(latest),
            woo_product_id: latest.product_id,
            woo_variation_id: latest.variation_id ?? null,
          };
          for (const [key, value] of Object.entries(expected)) {
            if (stable(value) !== stable(v[key] ?? null))
              changes.push({
                barcode: v.barcode,
                field: key,
                before: v[key] ?? null,
                after: value ?? null,
              });
          }
          flag(
            latest.manual_review === false &&
              latest.classification === "MATCH_EXACT_VARIANT" &&
              !latest.issues?.length &&
              !latest.commercial_checks?.length &&
              !latest.display_only,
            "SOURCE_MANUAL_REVIEW",
          );
        }
        const evidence = (r.sicar_evidence ?? []).filter(
          (e) => e.variant_id === v.id && e.barcode === v.barcode,
        );
        flag(
          evidence.length === 1 &&
            [
              "barcode",
              "price_cents",
              "attributes",
              "department",
              "section",
              "woo_product_id",
              "woo_variation_id",
            ].every(
              (key) =>
                stable(evidence[0]?.source_row?.[key] ?? null) ===
                stable(v[key] ?? null),
            ),
          "STAGING_SICAR_EVIDENCE_MISMATCH",
        );
        return {
          variant_id: v.id,
          barcode: v.barcode,
          price_cents: v.price_cents,
          attributes: v.attributes,
          department: v.department,
          section: v.section,
          source_woo_variation_id: v.woo_variation_id,
        };
      });
      flag(changes.length === 0, "STAGING_REFRESH_REQUIRED");
      // Report the rows outside the pilot, never synthesize them from Woo sizes.
      const missingSicar = latestRows
        .filter(
          (v) =>
            v.product_id === s.woo_product_id &&
            !c.variants.some((old) => old.barcode === v.barcode),
        )
        .map((v) => ({
          barcode: v.barcode,
          source_woo_variation_id: v.variation_id ?? null,
          classification: v.classification,
          manual_review: v.manual_review,
          attributes: attrs(v),
        }));
      flag(missingSicar.length === 0, "SICAR_FAMILY_NOT_FULLY_STAGED");
      const expectedWoo = [
        ...(s.variants ?? []).map((v) => v.woo_variation_id),
        ...(s.unselected_woo_variation_ids ?? []),
      ].filter((id) => id !== null);
      const missingWoo = expectedWoo.filter(
        (id) => !c.variants.some((v) => v.woo_variation_id === id),
      );
      if (s.type === "variable") {
        flag(
          expectedWoo.length > 0 &&
            expectedWoo.every(positive) &&
            unique(expectedWoo),
          "SOURCE_VARIANT_SET_REVIEW",
        );
        flag(
          missingWoo.length === 0 &&
            c.variants.every((v) => expectedWoo.includes(v.woo_variation_id)),
          "WOO_VARIANTS_OUTSIDE_PILOT",
        );
        flag(
          c.variants.every((v) => Object.keys(v.attributes ?? {}).length > 0),
          "VARIABLE_ATTRIBUTES_REQUIRED",
        );
        const f = r.family_evidence;
        flag(
          f?.product_id === r.product_id &&
            f.source_sha256 === r.source_sha256 &&
            f.source_fingerprint === r.source_fingerprint &&
            f.catalog_fingerprint === r.catalog_fingerprint &&
            /^[a-f0-9]{64}$/.test(f.evidence_sha256 ?? ""),
          "FAMILY_EVIDENCE_REQUIRED",
        );
      } else {
        flag(
          c.variants.length === 1 &&
            Object.keys(c.variants[0]?.attributes ?? {}).length === 0 &&
            expectedWoo.length === 0,
          "SIMPLE_STRUCTURE_REVIEW",
        );
      }
      const b = r.category_evidence;
      flag(
        b?.valid === true &&
          b.woo_product_id === s.woo_product_id &&
          /^[a-f0-9]{64}$/.test(b.evidence_sha256 ?? "") &&
          stable(b.mappings?.map((m) => m.path)) === stable(d.categories) &&
          unique(b.mappings?.map((m) => m.id) ?? []) &&
          unique(d.categories ?? []),
        "CATEGORY_EVIDENCE_REQUIRED",
      );
      flag(
        text(d.name) &&
          d.name.length <= 200 &&
          typeof d.description === "string" &&
          d.description.trim().length > 0 &&
          d.description.length <= 20000 &&
          text(d.base_code) &&
          d.short_description === d.base_code &&
          d.short_description.length <= 2000,
        "CONTENT_REVIEW",
      );
      const photos = (d.images ?? []).map((i) => {
        const prefix = `https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/${r.product_id}/`;
        const match =
          typeof i.url === "string" && i.url.startsWith(prefix)
            ? i.url
                .slice(prefix.length)
                .match(/^([a-f0-9]{64})\.(jpg|png|webp)$/)
            : null;
        flag(
          !!match && typeof i.alt === "string" && i.alt.length <= 240,
          "OWN_STORED_PHOTO_REQUIRED",
        );
        return { url: i.url, alt: i.alt, expected_sha256: match?.[1] ?? null };
      });
      flag(
        photos.length >= 1 &&
          photos.length <= 20 &&
          unique(photos.map((p) => p.expected_sha256)),
        "GALLERY_REVIEW",
      );
      const policy = displayPolicies.products.find(
        (p) =>
          p.product_id === r.product_id || p.woo_source_id === s.woo_product_id,
      );
      flag(!policy, "DISPLAY_ONLY_ADAPTER_REQUIRED");
      return {
        product_id: r.product_id,
        name: c.name,
        source_woo_product_id: s.woo_product_id,
        state: issues.size ? "REVIEW_REQUIRED" : "READY_FOR_ADAPTER_TEST_ONLY",
        reasons: [...issues].sort(),
        staged_variants: variants.length,
        photos: photos.length,
        changes,
        sicar_rows_outside_pilot: missingSicar,
        woo_variations_outside_pilot: missingWoo,
        // All rows retain their evidence; only structurally ready rows get a proposal.
        proposal: issues.size
          ? null
          : {
              target_origin: TEST_ORIGIN,
              product_id: r.product_id,
              editorial_revision: r.revision,
              source_fingerprint: r.source_fingerprint,
              catalog_fingerprint: r.catalog_fingerprint,
              type: s.type,
              content: { ...d, images: photos },
              variants,
              category_paths: b.mappings.map((m) => ({
                source_category_id: m.id,
                path: m.path,
              })),
              source_woo_product_id: s.woo_product_id,
              draft_only: true,
              purchasable: false,
            },
      };
    })
    .sort((a, b) =>
      a.product_id < b.product_id ? -1 : a.product_id > b.product_id ? 1 : 0,
    );
  const result = {
    version: "m9-remote-family-readiness-1",
    mode: "READ_ONLY",
    dispatch_allowed: false,
    inventory_included: false,
    target_origin: TEST_ORIGIN,
    inputs_sha256: hash({ snapshot, latestRows }),
    summary: {
      products: families.length,
      staged_variants: families.reduce((n, f) => n + f.staged_variants, 0),
      ready_for_adapter_test: families.filter((f) => f.proposal).length,
      review_required: families.filter((f) => !f.proposal).length,
      products_needing_refresh: families.filter((f) => f.changes.length).length,
    },
    families,
  };
  return { ...result, report_sha256: hash(result) };
}
