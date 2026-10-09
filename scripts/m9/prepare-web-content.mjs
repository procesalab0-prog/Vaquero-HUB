import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
const text = (value) => (typeof value === "string" ? value : "");
const hasText = (value) =>
  text(value)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim().length > 0;
const money = (cents) =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

// Evidence packet only: deliberately not a Woo REST payload or an uploader.
export function prepareWebContent(rows, woo) {
  if (
    !Array.isArray(rows) ||
    !Array.isArray(woo.products) ||
    woo.pagination_complete !== true
  )
    throw new Error("INCOMPLETE_INPUT");
  const ids = new Set(),
    codes = new Set(),
    groups = new Map();
  for (const p of woo.products) {
    if (ids.has(p.id)) throw new Error("DUPLICATE_WOO_PARENT");
    ids.add(p.id);
  }
  for (const row of rows) {
    if (
      typeof row.barcode !== "string" ||
      !row.barcode ||
      codes.has(row.barcode)
    )
      throw new Error("INVALID_OR_DUPLICATE_BARCODE");
    if (!Number.isSafeInteger(row.price_cents) || row.price_cents <= 0)
      throw new Error("INVALID_RETAIL_PRICE");
    codes.add(row.barcode);
    if (!groups.has(row.woo_product_id)) groups.set(row.woo_product_id, []);
    groups.get(row.woo_product_id).push(row);
  }
  const packets = [];
  for (const [id, variants] of [...groups].sort(([a], [b]) => a - b)) {
    const matches = woo.products.filter((p) => p.id === id);
    if (matches.length !== 1) throw new Error("WOO_PARENT_NOT_FOUND");
    const parent = matches[0];
    const issues = [];
    if (parent.status !== "publish") issues.push("SOURCE_NOT_PUBLISHED");
    if (!["simple", "variable"].includes(parent.type))
      issues.push("UNSUPPORTED_PRODUCT_TYPE");
    if (!hasText(parent.name)) issues.push("MISSING_NAME");
    if (!hasText(parent.description)) issues.push("MISSING_LONG_DESCRIPTION");
    if (!hasText(parent.short_description))
      issues.push("MISSING_SHORT_DESCRIPTION");
    const images = text(parent.images)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (!images.length) issues.push("MISSING_IMAGES");
    if (
      images.some((v) => {
        try {
          const u = new URL(v);
          return u.protocol !== "https:" || Boolean(u.username || u.password);
        } catch {
          return true;
        }
      })
    )
      issues.push("INVALID_IMAGE_URL");
    // CSV names are evidence, never treated as category IDs or mapped from SICAR.
    issues.push("CATEGORY_IDS_REQUIRE_VERIFIED_MAPPING");
    const seenVariants = new Set();
    const mapped = variants
      .sort((a, b) =>
        a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0,
      )
      .map((row) => {
        let source = parent;
        if (parent.type === "variable") {
          const matches = (parent.variations ?? []).filter(
            (v) => v.id === row.woo_variation_id,
          );
          if (matches.length !== 1) throw new Error("WOO_VARIATION_NOT_UNIQUE");
          source = matches[0];
          if (seenVariants.has(source.id))
            throw new Error("DUPLICATE_WOO_VARIATION");
          seenVariants.add(source.id);
          if (source.status !== "publish")
            issues.push("VARIATION_NOT_PUBLISHED");
        } else if (row.woo_variation_id !== null || variants.length !== 1)
          throw new Error("INVALID_SIMPLE_MAPPING");
        return {
          barcode: row.barcode,
          woo_variation_id: row.woo_variation_id,
          attributes_sicar: row.attributes,
          attributes_woo: source.attributes ?? [],
          department: row.department,
          section: row.section,
          retail_from_sicar: money(row.price_cents),
          regular_price_woo: text(source.price),
          sale_price_woo: text(source.sale_price),
          promotion_start: text(
            source.source_fields?.["Día en que empieza el precio rebajado"],
          ),
          promotion_end: text(
            source.source_fields?.["Día en que termina el precio rebajado"],
          ),
          images_woo: text(source.images),
        };
      });
    const selected = new Set(mapped.map((v) => v.woo_variation_id));
    packets.push({
      woo_product_id: id,
      proposed_action: "REVIEW_EXISTING_LINK",
      create_new_parent: false,
      name: text(parent.name),
      type: parent.type,
      source_status: parent.status,
      description_html: text(parent.description),
      short_description_html: text(parent.short_description),
      image_urls: images,
      categories_source: text(parent.categories),
      category_ids: null,
      parent_attributes_source: parent.attributes ?? [],
      variants: mapped,
      unselected_woo_variation_ids: (parent.variations ?? [])
        .filter((v) => !selected.has(v.id))
        .map((v) => v.id)
        .sort((a, b) => a - b),
      issues: [...new Set(issues)].sort(),
    });
  }
  return {
    version: "m9-web-content-1",
    purpose: "READ_ONLY_EVIDENCE_NOT_IMPORTABLE",
    woo_writes_enabled: false,
    inventory_included: false,
    policy: {
      html: "Untrusted source HTML; escape for display. Review and sanitize before future publishing.",
      partial_families:
        "Preserve all unselected variants; never replace family with this pilot subset.",
      prices:
        "SICAR retail is the baseline; Woo promotions preserved as evidence, never overwritten.",
      new_products:
        "Separate future flow: capture web content once; initial draft recommended; no creation in this packet.",
    },
    products: packets,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 8)
    throw new Error(
      "Usage: --payload FILE --woo FILE --manifest FILE --out NEW_DIR",
    );
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--payload", "--woo", "--manifest", "--out"].includes(args[i]) ||
      options[args[i]]
    )
      throw new Error("INVALID_ARGUMENTS");
    options[args[i]] = args[i + 1];
  }
  const [payload, woo, manifestRaw] = await Promise.all(
    ["--payload", "--woo", "--manifest"].map((k) => readFile(options[k])),
  );
  const manifest = JSON.parse(manifestRaw);
  if (
    sha256(payload) !== manifest.payload_sha256 ||
    sha256(woo) !== manifest.woo_sha256
  )
    throw new Error("SOURCE_HASH_MISMATCH");
  const packet = prepareWebContent(JSON.parse(payload), JSON.parse(woo));
  const serialized =
    JSON.stringify(
      {
        ...packet,
        sources: {
          payload_sha256: sha256(payload),
          woo_sha256: sha256(woo),
          manifest_sha256: sha256(manifestRaw),
        },
      },
      null,
      2,
    ) + "\n";
  const counts = {
    products: packet.products.length,
    variants: packet.products.reduce((n, p) => n + p.variants.length, 0),
    missing_long_description: packet.products.filter((p) =>
      p.issues.includes("MISSING_LONG_DESCRIPTION"),
    ).length,
    missing_images: packet.products.filter((p) =>
      p.issues.includes("MISSING_IMAGES"),
    ).length,
    partial_families: packet.products.filter(
      (p) => p.unselected_woo_variation_ids.length,
    ).length,
  };
  const summary = `# Preparación de contenido WooCommerce\n\nSólo evidencia local; no es un archivo importable.\n\n- Productos existentes vinculados: ${counts.products}.\n- Variantes del piloto: ${counts.variants}.\n- Sin descripción larga: ${counts.missing_long_description}.\n- Sin imágenes: ${counts.missing_images}.\n- Familias con otras variantes fuera del piloto: ${counts.partial_families}.\n\nSe conservan textos HTML originales, enlaces de imágenes, atributos, IDs y promociones. No se descargan imágenes ni se ejecuta HTML. Los nombres de categorías requieren correspondencia verificable con IDs; departamento/sección SICAR no se usan como categorías Woo. No crear padres duplicados ni eliminar las variantes ajenas al piloto.\n\nPendiente: revisar contenido, resolver IDs de categorías y completar el formulario de alta web con guardado/reintentos en staging. No hay publicación, importación de existencias ni cambios de precio remotos.\n`;
  await mkdir(options["--out"]);
  await writeFile(resolve(options["--out"], "contenido.json"), serialized, {
    flag: "wx",
  });
  await writeFile(resolve(options["--out"], "resumen.md"), summary, {
    flag: "wx",
  });
  await writeFile(
    resolve(options["--out"], "sha256.json"),
    JSON.stringify(
      { "contenido.json": sha256(serialized), "resumen.md": sha256(summary) },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(counts));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
