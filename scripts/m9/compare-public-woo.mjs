import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const hash = (s) => createHash("sha256").update(s).digest("hex");
const json = (s) => JSON.stringify(s, null, 2) + "\n";
const safe = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function parents(snapshot, scope) {
  if (
    snapshot.schema_version !== 1 ||
    snapshot.scope !== scope ||
    snapshot.pagination_complete !== true ||
    !Array.isArray(snapshot.products)
  )
    throw Error("SOURCE_SCOPE_INCOMPLETE");
  const map = new Map();
  for (const p of snapshot.products) {
    if (
      !Number.isSafeInteger(p.id) ||
      p.id <= 0 ||
      map.has(p.id) ||
      !["simple", "variable"].includes(p.type)
    )
      throw Error("PARENT_IDENTITY_INVALID");
    map.set(p.id, p);
  }
  return map;
}
function images(p) {
  const list =
    typeof p.images === "string"
      ? p.images.split(/,\s*/).filter(Boolean)
      : p.images;
  if (!Array.isArray(list)) throw Error("IMAGE_REPRESENTATION_INVALID");
  return list.map((v) => {
    const s = typeof v === "string" ? v : v.src;
    if (typeof s !== "string") throw Error("IMAGE_URL_INVALID");
    const u = new URL(s);
    if (u.protocol !== "https:") throw Error("HTTPS_IMAGE_REQUIRED");
    // Keep literal URLs. A CDN rewrite is NOT proof that the photograph changed.
    return s;
  });
}
export function comparePublicWoo(full, published) {
  const old = parents(full, "authenticated_csv_excludes_trash");
  const current = parents(published, "published_public");
  if (
    full.expected_parents_from_panel !== old.size ||
    !/^[a-f0-9]{64}$/.test(full.source_csv_sha256 ?? "") ||
    !Number.isFinite(Date.parse(published.captured_at)) ||
    published.source !== "https://vaquerosm.com"
  )
    throw Error("SOURCE_PROVENANCE_REQUIRED");
  if (
    [...old.values()].some(
      (p) => !["publish", "private", "draft"].includes(p.status),
    )
  )
    throw Error("HISTORICAL_STATUS_REQUIRED");
  const rows = [...current.values()]
    .sort((a, b) => a.id - b.id)
    .map((p) => {
      const before = old.get(p.id);
      if (!before)
        return {
          id: p.id,
          new_public_parent: true,
          automatically_linked: false,
        };
      const rawDifferences = [
        "type",
        "sku",
        "name",
        "short_description",
        "description",
      ].filter((k) => before[k] !== p[k]);
      const imageUrlsDiffer =
        JSON.stringify(images(before)) !== JSON.stringify(images(p));
      return {
        id: p.id,
        historical_status: before.status,
        observed_publicly: true,
        raw_text_or_identity_differences: rawDifferences,
        image_literal_urls_differ: imageUrlsDiffer,
        historical_image_count: images(before).length,
        public_image_count: images(p).length,
      };
    });
  const unseen = [...old.values()]
    .filter((p) => !current.has(p.id))
    .sort((a, b) => a.id - b.id)
    .map((p) => ({
      id: p.id,
      historical_status: p.status,
      current_status: "UNOBSERVED",
      deletion_confirmed: false,
    }));
  return {
    protocol: "m9-public-complement-comparison-1",
    captured_at: published.captured_at,
    scope: "published_parent_observations_only",
    authenticated_source_retained: true,
    automatic_writes: [],
    variations_observed: false,
    stock_authority: "SICAR",
    prices_compared: false,
    categories_comparable: false,
    caveats: [
      "Raw text may differ because CSV and Store API encode HTML differently.",
      "Literal image URLs may differ because of CDN rewriting; no media identity or content change is inferred.",
      "Category paths in CSV and Store API category objects are different representations; no taxonomy correction is inferred.",
      "Absence from the public endpoint is not deletion, nor a new private/draft status.",
      "No full-catalog freshness or unpublished-variation coverage is certified.",
    ],
    summary: {
      historical_full_parents: old.size,
      public_parents: current.size,
      shared: rows.filter((r) => !r.new_public_parent).length,
      new_public_ids: rows.filter((r) => r.new_public_parent).length,
      unobserved_publicly: unseen.length,
      formerly_unpublished_observed_publicly: rows.filter(
        (r) => r.historical_status && r.historical_status !== "publish",
      ).length,
      shared_with_raw_differences: rows.filter(
        (r) => r.raw_text_or_identity_differences?.length,
      ).length,
      shared_with_literal_image_url_differences: rows.filter(
        (r) => r.image_literal_urls_differ,
      ).length,
    },
    rows,
    unobserved: unseen,
  };
}
export async function run(fullPath, publicPath, outDir) {
  const [a, b] = await Promise.all([readFile(fullPath), readFile(publicPath)]);
  const result = comparePublicWoo(JSON.parse(a), JSON.parse(b));
  const receipt = {
    ...result,
    source_files: { authenticated_sha256: hash(a), public_sha256: hash(b) },
  };
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  await writeFile(resolve(outDir, "comparacion.json"), json(receipt), {
    flag: "wx",
    mode: 0o600,
  });
  const body = `<!doctype html><html lang="es"><meta charset="utf-8"><title>M9 · Complemento público Woo</title><style>body{font:18px system-ui;max-width:1050px;margin:40px auto;padding:20px;color:#182d3b}table{border-collapse:collapse;width:100%}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}aside{padding:20px;background:#fff1d0}</style><h1>Woo: renovación del complemento público</h1><p>Captura: ${safe(result.captured_at)}. Sólo consultas GET sin credenciales; sin cambios en Woo o inventario.</p><table>${Object.entries(
    result.summary,
  )
    .map(([k, v]) => `<tr><th>${safe(k)}</th><td>${safe(v)}</td></tr>`)
    .join(
      "",
    )}</table><aside><p>Los productos no observados se conservan. Este corte no sustituye el CSV autenticado del 19 de octubre ni sus borradores, privados y variaciones.</p><p>Las diferencias de texto y URL son literales: HTML y CDN pueden explicar cambios de formato. No se aplican automáticamente al programa.</p></aside><p>Fotos, textos y categorías públicas quedan disponibles como evidencia complementaria. El catálogo maestro y los códigos siguen siendo de SICAR.</p><p>Huella CSV normalizado: ${safe(hash(a))}<br>Huella complemento: ${safe(hash(b))}</p></html>`;
  await writeFile(resolve(outDir, "reporte.html"), body, {
    flag: "wx",
    mode: 0o600,
  });
  return receipt.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 5)
    throw Error(
      "Usage: node compare-public-woo.mjs FULL_JSON PUBLIC_JSON NEW_OUTPUT_DIRECTORY",
    );
  console.log(JSON.stringify(await run(...process.argv.slice(2))));
}
