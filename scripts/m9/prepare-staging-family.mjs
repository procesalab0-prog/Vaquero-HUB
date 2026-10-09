import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifiedFile } from "./review-web-families.mjs";
import { sha256 } from "./prepare-web-content.mjs";

// Preparation only. Applying still requires the operator-only staging plan/token.
export function prepareFamily(report, rows, parentId) {
  const families = report.families.filter((f) => f.woo_product_id === parentId);
  if (report.version !== "m9-web-family-review-1" || families.length !== 1)
    throw new Error("INVALID_FAMILY");
  const f = families[0];
  if (
    f.type !== "variable" ||
    f.issues.length ||
    f.diagnostic_state !== "IDENTITY_AND_CATEGORIES_CHECKED_NOT_APPROVED" ||
    !f.woo_members.length ||
    f.historical_child_ids.length ||
    f.sicar_candidate_rows.length
  )
    throw new Error("UNRESOLVED_FAMILY");
  const codes = new Set(),
    children = new Set(),
    combinations = new Set();
  return f.woo_members
    .map((v) => {
      if (
        v.state !== "EXACT_CANONICAL_LINK" ||
        v.sicar.length !== 1 ||
        v.status !== "publish"
      )
        throw new Error("UNRESOLVED_MEMBER");
      const matched = rows.filter((r) => r.barcode === v.sicar[0].barcode);
      if (matched.length !== 1) throw new Error("AMBIGUOUS_BARCODE");
      const r = matched[0],
        fields = r.fields;
      if (
        r.manual_review ||
        r.classification !== "MATCH_EXACT_VARIANT" ||
        r.issues.length ||
        r.commercial_checks.length ||
        r.display_only ||
        r.product_id !== parentId ||
        r.variation_id !== v.woo_id ||
        r.barcode !== fields["clave1 *"] ||
        r.description !== fields["descripción *"] ||
        r.description !== v.sicar[0].description ||
        fields.departamento !== v.sicar[0].department ||
        fields.categoria !== v.sicar[0].section ||
        fields.precio1 !== v.sicar[0].retail_sicar ||
        r.cost_status !== "not_captured" ||
        r.price_mapping_status !== "retail_confirmed_other_levels_undefined"
      )
        throw new Error("SOURCE_DISAGREEMENT");
      const attributes = {};
      for (const a of r.attributes) {
        const key = { Talla: "TALLA", Color: "COLOR", Largo: "LARGO" }[a.name];
        if (
          !key ||
          attributes[key] ||
          !a.value ||
          v.attributes.filter((w) => w.name === a.name && w.option === a.value)
            .length !== 1
        )
          throw new Error("ATTRIBUTE_DISAGREEMENT");
        attributes[key] = a.value;
      }
      if (!r.attributes.length || r.attributes.length !== v.attributes.length)
        throw new Error("ATTRIBUTE_DISAGREEMENT");
      const combination = JSON.stringify(Object.entries(attributes).sort());
      if (
        codes.has(r.barcode) ||
        children.has(v.woo_id) ||
        combinations.has(combination)
      )
        throw new Error("DUPLICATE_MEMBER");
      codes.add(r.barcode);
      children.add(v.woo_id);
      combinations.add(combination);
      if (!/^\d+(\.\d{1,2})?$/.test(fields.precio1))
        throw new Error("INVALID_PRICE");
      const [whole, decimals = ""] = fields.precio1.split(".");
      const price = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
      if (!Number.isSafeInteger(price) || price <= 0)
        throw new Error("INVALID_PRICE");
      return {
        barcode: r.barcode,
        product_name: f.name,
        woo_product_id: parentId,
        woo_variation_id: v.woo_id,
        description: r.description,
        department: fields.departamento,
        section: fields.categoria,
        price_cents: price,
        cost_cents: null,
        attributes,
      };
    })
    .sort((a, b) => a.woo_variation_id - b.woo_variation_id);
}

async function main() {
  const [familyDir, reportDir, parent, out] = process.argv.slice(2);
  if (process.argv.length !== 6 || !/^[1-9]\d*$/.test(parent))
    throw new Error(
      "Usage: FAMILY_DIR REPORT_DIR WOO_PARENT_ID NEW_OUTPUT_DIR",
    );
  const family = await verifiedFile(familyDir, "familias.json");
  const rows = await verifiedFile(reportDir, "filas.json");
  const manifest = await verifiedFile(reportDir, "manifest.json");
  if (
    family.data.sources.rows_sha256 !== sha256(rows.raw) ||
    family.data.sources.manifest_sha256 !== sha256(manifest.raw) ||
    family.data.sources.sicar_sha256 !== manifest.data.sicar_sha256 ||
    family.data.sources.woo_sha256 !== manifest.data.woo_sha256
  )
    throw new Error("SOURCE_HASH_MISMATCH");
  const payload = prepareFamily(family.data, rows.data, Number(parent));
  const serialized = JSON.stringify(payload, null, 2) + "\n";
  const files = {
    "payload.json": serialized,
    "manifest.json":
      JSON.stringify(
        {
          version: "m9-staging-family-preparation-1",
          project_id: "zsezjtswqeijboezvado",
          purpose: "STAGING_OPERATOR_PLAN_REQUIRED",
          inventory_included: false,
          woo_writes_enabled: false,
          editorial_approved: false,
          woo_product_id: Number(parent),
          rows: payload.length,
          payload_sha256: sha256(serialized),
          family_sha256: sha256(family.raw),
          ...family.data.sources,
        },
        null,
        2,
      ) + "\n",
  };
  await mkdir(resolve(out));
  for (const [name, content] of Object.entries(files))
    await writeFile(resolve(out, name), content);
  await writeFile(
    resolve(out, "sha256.json"),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(files).map(([name, content]) => [name, sha256(content)]),
      ),
      null,
      2,
    ) + "\n",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
