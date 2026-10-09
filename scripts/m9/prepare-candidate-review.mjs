import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "./prepare-web-content.mjs";
import { verifiedFile } from "./review-web-families.mjs";

const escape = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const cents = (v) => {
  if (typeof v !== "string" || !/^\d+(\.\d{1,2})?$/.test(v))
    throw new Error("INVALID_MONEY");
  const [whole, part = ""] = v.split(".");
  const value = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("INVALID_MONEY");
  return value;
};
export function candidateReview(report, woo) {
  if (
    report.version !== "m9-web-family-review-1" ||
    woo.pagination_complete !== true
  )
    throw new Error("INVALID_SOURCE");
  const products = [],
    excluded = [],
    seenCodes = new Set(),
    seenIds = new Set();
  for (const f of report.families) {
    if (
      f.issues.length ||
      f.diagnostic_state !== "IDENTITY_AND_CATEGORIES_CHECKED_NOT_APPROVED"
    ) {
      excluded.push(f.woo_product_id);
      continue;
    }
    const matches = woo.products.filter((p) => p.id === f.woo_product_id);
    if (matches.length !== 1 || seenIds.has(f.woo_product_id))
      throw new Error("INVALID_PARENT");
    seenIds.add(f.woo_product_id);
    const p = matches[0];
    const original = p.type === "simple" ? [p] : p.variations;
    if (
      !["simple", "variable"].includes(p.type) ||
      p.status !== "publish" ||
      !original?.length ||
      original.length !== f.woo_members.length ||
      (p.type === "simple" && p.variations?.length)
    )
      throw new Error("INCOMPLETE_FAMILY");
    const expected = original.map((v) => v.id).sort((a, b) => a - b),
      actual = f.woo_members.map((v) => v.woo_id).sort((a, b) => a - b);
    if (
      new Set(actual).size !== actual.length ||
      JSON.stringify(actual) !== JSON.stringify(expected)
    )
      throw new Error("FAMILY_CHANGED");
    if (
      !Array.isArray(f.categories.verified_ids) ||
      !f.categories.verified_ids.length ||
      f.categories.state !== "VERIFIED_PATH_AND_PUBLIC_MEMBERSHIP"
    )
      throw new Error("UNVERIFIED_CATEGORIES");
    const variants = f.woo_members.map((v) => {
      if (v.state !== "EXACT_CANONICAL_LINK" || v.sicar.length !== 1)
        throw new Error("UNRESOLVED_MEMBER");
      const r = v.sicar[0],
        source = original.find((x) => x.id === v.woo_id);
      if (
        typeof r.barcode !== "string" ||
        !r.barcode ||
        seenCodes.has(r.barcode) ||
        source.status !== "publish" ||
        r.manual_review ||
        r.classification !== "MATCH_EXACT_VARIANT"
      )
        throw new Error("UNRESOLVED_BARCODE");
      seenCodes.add(r.barcode);
      if (cents(r.retail_sicar) !== cents(source.price))
        throw new Error("PRICE_CHANGED");
      return {
        barcode: r.barcode,
        woo_id: v.woo_id,
        woo_variation_id: p.type === "simple" ? null : v.woo_id,
        in_original_pilot: v.in_pilot,
        attributes: source.attributes ?? [],
        department: r.department,
        section: r.section,
        retail_sicar: r.retail_sicar,
        regular_price_woo: source.price,
        sale_price_woo: source.sale_price ?? "",
        promotion_start: v.promotion_start,
        promotion_end: v.promotion_end,
        proposed_price_change: null,
      };
    });
    const images = (p.images ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const editorial = [];
    if (
      !p.name?.trim() ||
      !p.description?.trim() ||
      !p.short_description?.trim() ||
      !images.length
    )
      editorial.push("MISSING_EDITORIAL_CONTENT");
    if (/<[^>]*>/.test(p.description ?? ""))
      editorial.push("SOURCE_HTML_REQUIRES_EDITORIAL_REVIEW");
    if (
      images.some((s) => {
        try {
          const u = new URL(s);
          return (
            u.protocol !== "https:" ||
            u.hostname !== "vaquerosm.com" ||
            !u.pathname.startsWith("/wp-content/uploads/") ||
            !!(u.username || u.password)
          );
        } catch {
          return true;
        }
      })
    )
      editorial.push("IMAGE_URL_REQUIRES_REVIEW");
    products.push({
      woo_product_id: p.id,
      name: p.name,
      type: p.type,
      baseline: {
        description: p.description,
        short_description: p.short_description,
        image_urls: images,
        categories: f.categories.verified_ids,
        status: p.status,
      },
      variants,
      editorial_flags: editorial,
      editorial_approved: false,
      send_allowed: false,
      proposed_remote_changes: [],
      create_parent: false,
      delete_variations: [],
      review_note:
        "Baseline from saved exports, not a comparison with human staging drafts or current live Woo. Preserve existing IDs. No remote change proposed without reviewed editorial changes.",
    });
  }
  return {
    version: "m9-candidate-review-1",
    purpose: "READ_ONLY_NOT_IMPORTABLE",
    woo_writes_enabled: false,
    inventory_included: false,
    products,
    excluded_parent_ids: excluded,
    counts: {
      families: products.length,
      members: products.reduce((n, p) => n + p.variants.length, 0),
      already_in_original_pilot: products.reduce(
        (n, p) => n + p.variants.filter((v) => v.in_original_pilot).length,
        0,
      ),
      editorial_flagged_families: products.filter(
        (p) => p.editorial_flags.length,
      ).length,
      proposed_remote_changes: 0,
    },
  };
}
export function renderReview(packet) {
  return (
    '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Lote candidato M9</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:0 20px;color:#20252b}article{border-top:2px solid #ddd;padding:20px 0}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:8px;text-align:left;border-bottom:1px solid #ddd}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:16px}strong{color:#763900}</style><h1>Lote candidato: ' +
    packet.counts.families +
    " familias / " +
    packet.counts.members +
    " variantes o productos</h1><p>Revisión local sobre exportaciones conservadas. No es aprobación ni archivo importable. No consulta ni modifica WooCommerce.</p><p><strong>Cero cambios remotos propuestos.</strong> Estas fichas ya existen en Woo. Conservar IDs, códigos SICAR, fotografías y precios. La revisión editorial y la prueba de envío están pendientes.</p><p>De los " +
    packet.counts.members +
    " miembros, " +
    packet.counts.already_in_original_pilot +
    " estaban en el piloto inicial; el resto no se ha cargado por este reporte. Los precios distintos por talla se conservan.</p>" +
    packet.products
      .map(
        (p) =>
          "<article><h2>" +
          escape(p.name) +
          "</h2><p>Woo " +
          p.woo_product_id +
          " · Categorías: " +
          p.baseline.categories.join(", ") +
          " · Fotos referenciadas: " +
          p.baseline.image_urls.length +
          "</p><p><strong>" +
          (p.editorial_flags.length
            ? "Revisar formato HTML/contenido de origen antes de preparar el envío."
            : "Revisión visual/editorial pendiente.") +
          "</strong></p><p>Código base: " +
          escape(p.baseline.short_description) +
          "</p><details><summary>Descripción de origen (texto escapado, sin ejecutar HTML)</summary><pre>" +
          escape(p.baseline.description) +
          "</pre></details><details><summary>Enlaces a las fotografías originales</summary><ul>" +
          p.baseline.image_urls
            .map((u) => "<li>" + escape(u) + "</li>")
            .join("") +
          "</ul></details><table><thead><tr><th>Código SICAR</th><th>Atributos Woo</th><th>Precio SICAR / Woo</th><th>Departamento / sección</th><th>Piloto inicial</th></tr></thead><tbody>" +
          p.variants
            .map(
              (v) =>
                "<tr><td>" +
                escape(v.barcode) +
                "</td><td>" +
                escape(
                  v.attributes.map((a) => a.name + ": " + a.option).join(", "),
                ) +
                "</td><td>$" +
                escape(v.retail_sicar) +
                " / $" +
                escape(v.regular_price_woo) +
                "</td><td>" +
                escape(v.department) +
                " / " +
                escape(v.section) +
                "</td><td>" +
                (v.in_original_pilot ? "Sí" : "No") +
                "</td></tr>",
            )
            .join("") +
          "</tbody></table></article>",
      )
      .join("") +
    "</html>"
  );
}
async function main() {
  const [dir, wooPath, out] = process.argv.slice(2);
  if (process.argv.length !== 5)
    throw new Error("Usage: FAMILY_REPORT_DIR WOO_JSON NEW_OUT");
  const report = await verifiedFile(dir, "familias.json"),
    raw = await readFile(wooPath);
  if (sha256(raw) !== report.data.sources.woo_sha256)
    throw new Error("SOURCE_HASH_MISMATCH");
  const packet = candidateReview(report.data, JSON.parse(raw));
  packet.sources = {
    family_report_sha256: sha256(report.raw),
    woo_sha256: sha256(raw),
  };
  const files = {
    "lote.json": JSON.stringify(packet, null, 2) + "\n",
    "revision.html": renderReview(packet),
  };
  await mkdir(out);
  for (const [name, body] of Object.entries(files))
    await writeFile(resolve(out, name), body, { flag: "wx" });
  await writeFile(
    resolve(out, "sha256.json"),
    JSON.stringify(
      Object.fromEntries(Object.entries(files).map(([n, v]) => [n, sha256(v)])),
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(packet.counts));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
