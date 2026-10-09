import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "./prepare-web-content.mjs";

const sorted = (values) => [...new Set(values)].sort((a, b) => a - b);
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const validId = (id) => Number.isSafeInteger(id) && id > 0;

export function categoryPaths(categories) {
  const byId = new Map();
  for (const c of categories) {
    if (
      !validId(c.id) ||
      !Number.isSafeInteger(c.parent) ||
      c.parent < 0 ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      byId.has(c.id)
    )
      throw new Error("INVALID_OR_DUPLICATE_CATEGORY");
    byId.set(c.id, c);
  }
  const path = (id, seen = new Set()) => {
    if (seen.has(id)) throw new Error("CATEGORY_CYCLE");
    const c = byId.get(id);
    if (!c) throw new Error("CATEGORY_PARENT_MISSING");
    seen.add(id);
    return c.parent ? `${path(c.parent, seen)} > ${c.name}` : c.name;
  };
  return [...byId.values()]
    .map((c) => ({
      id: c.id,
      parent: c.parent,
      name: c.name,
      path: path(c.id),
    }))
    .sort((a, b) => a.id - b.id);
}

export function reviewWebFamilies(content, woo, rows, taxonomy) {
  if (
    woo.pagination_complete !== true ||
    taxonomy.pagination_complete !== true ||
    taxonomy.total !== taxonomy.categories?.length ||
    !Array.isArray(rows)
  )
    throw new Error("INCOMPLETE_INPUT");
  const categories = categoryPaths(taxonomy.categories);
  const paths = new Map();
  for (const c of categories)
    paths.set(c.path, [...(paths.get(c.path) ?? []), c.id]);
  const parents = new Map(),
    allIds = new Set(),
    barcodes = new Set();
  for (const p of woo.products) {
    for (const item of [p, ...(p.variations ?? [])]) {
      if (!validId(item.id) || allIds.has(item.id))
        throw new Error("INVALID_OR_DUPLICATE_WOO_ID");
      allIds.add(item.id);
    }
    parents.set(p.id, p);
  }
  for (const r of rows) {
    if (typeof r.barcode !== "string" || !r.barcode || barcodes.has(r.barcode))
      throw new Error("INVALID_OR_DUPLICATE_BARCODE");
    barcodes.add(r.barcode);
  }
  const publicProducts = new Map();
  for (const p of taxonomy.products) {
    if (
      !validId(p.id) ||
      publicProducts.has(p.id) ||
      (p.status === 200 && p.data?.id !== p.id)
    )
      throw new Error("INVALID_PUBLIC_PRODUCT");
    publicProducts.set(p.id, p);
  }
  const selectedParents = new Set();
  const families = content.products
    .map((packet) => {
      const parent = parents.get(packet.woo_product_id);
      if (!parent || selectedParents.has(parent.id))
        throw new Error("INVALID_PILOT_PARENT");
      selectedParents.add(parent.id);
      if (packet.categories_source !== parent.categories)
        throw new Error("PILOT_SOURCE_CHANGED");
      const relevant = rows.filter(
        (r) =>
          r.product_id === parent.id ||
          r.candidate_product_ids?.includes(parent.id),
      );
      const summarizeRow = (r) => ({
        row: r.row,
        barcode: r.barcode,
        description: r.description,
        department: r.fields.departamento,
        section: r.fields.categoria,
        retail_sicar: r.fields.precio1,
        classification: r.classification,
        manual_review: r.manual_review,
        reasons: r.reasons,
        issues: r.issues,
        commercial_checks: r.commercial_checks,
        product_id: r.product_id,
        variation_id: r.variation_id,
        candidate_product_ids: r.candidate_product_ids,
        candidate_variation_ids: r.candidate_variation_ids,
        attributes: r.attributes,
      });
      const linked = (v) =>
        rows.filter(
          (r) =>
            r.product_id === parent.id &&
            r.variation_id === (parent.type === "simple" ? null : v.id),
        );
      const children =
        parent.type === "simple" ? [parent] : (parent.variations ?? []);
      const items = children.map((v) => {
        const assigned = linked(v);
        const exact = assigned.filter(
          (r) =>
            r.classification === "MATCH_EXACT_VARIANT" &&
            r.manual_review === false,
        );
        const state =
          assigned.length > 1
            ? "MULTIPLE_SICAR_LINKS_REVIEW"
            : exact.length === 1 && v.status === "publish"
              ? "EXACT_CANONICAL_LINK"
              : assigned.length
                ? "CANONICAL_REVIEW"
                : "NO_CONFIRMED_SICAR_LINK";
        return {
          woo_id: v.id,
          status: v.status,
          attributes: v.attributes ?? [],
          regular_price_woo: v.price,
          sale_price_woo: v.sale_price,
          promotion_start:
            v.source_fields?.["Día en que empieza el precio rebajado"] ?? "",
          promotion_end:
            v.source_fields?.["Día en que termina el precio rebajado"] ?? "",
          in_pilot: packet.variants.some(
            (r) =>
              r.woo_variation_id === (parent.type === "simple" ? null : v.id),
          ),
          state,
          sicar: assigned.map(summarizeRow),
          preserve_existing: true,
        };
      });
      for (const p of packet.variants) {
        const matches = rows.filter(
          (r) =>
            r.barcode === p.barcode &&
            r.product_id === parent.id &&
            r.variation_id === p.woo_variation_id &&
            r.classification === "MATCH_EXACT_VARIANT" &&
            r.manual_review === false,
        );
        if (
          matches.length !== 1 ||
          !items.some(
            (i) =>
              (parent.type === "simple" ? null : i.woo_id) ===
              p.woo_variation_id,
          )
        )
          throw new Error("PILOT_LINK_CHANGED");
      }
      if (
        parent.type === "variable" &&
        !same(
          packet.unselected_woo_variation_ids,
          items.filter((i) => !i.in_pilot).map((i) => i.woo_id),
        )
      )
        throw new Error("PILOT_OMISSIONS_CHANGED");
      const source = parent.categories ?? "";
      const tokens = source
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const mapping = tokens.map((path) => ({
        source_path: path,
        candidate_ids: paths.get(path) ?? [],
      }));
      // Never guess CSV escaping or flatten a hierarchy; such paths stay manual.
      const unsafeSyntax =
        source.includes("\\") ||
        categories.some(
          (c) => /[,<>]|&(?:#\d+|\w+);/.test(c.name) && source.includes(c.name),
        );
      const uniqueMapping =
        !unsafeSyntax &&
        mapping.length > 0 &&
        mapping.every((m) => m.candidate_ids.length === 1);
      const proposedIds = uniqueMapping
        ? sorted(mapping.flatMap((m) => m.candidate_ids))
        : null;
      const live = publicProducts.get(parent.id);
      const liveCats =
        live?.status === 200 && Array.isArray(live.data.categories)
          ? live.data.categories
          : null;
      const liveIds = liveCats?.map((c) => c.id) ?? [];
      const knownLiveIds =
        liveIds.every((id) => categories.some((c) => c.id === id)) &&
        new Set(liveIds).size === liveIds.length;
      const categoryState =
        proposedIds && liveCats && knownLiveIds && same(proposedIds, liveIds)
          ? "VERIFIED_PATH_AND_PUBLIC_MEMBERSHIP"
          : "MANUAL_REVIEW";
      const linkedRows = relevant.filter((r) => r.product_id === parent.id);
      const candidateOnly = relevant.filter(
        (r) =>
          r.product_id !== parent.id ||
          !items.some(
            (i) =>
              (parent.type === "simple" ? null : i.woo_id) === r.variation_id,
          ),
      );
      const sections = [
        ...new Set(linkedRows.map((r) => r.fields.categoria)),
      ].sort();
      const issues = [];
      if (categoryState !== "VERIFIED_PATH_AND_PUBLIC_MEMBERSHIP")
        issues.push("CATEGORY_REVIEW");
      if (items.some((i) => i.state !== "EXACT_CANONICAL_LINK"))
        issues.push("UNRESOLVED_WOO_MEMBERS");
      if (candidateOnly.length) issues.push("UNRESOLVED_SICAR_CANDIDATES");
      if (sections.length > 1) issues.push("MULTIPLE_SICAR_SECTIONS");
      if (parent.status !== "publish") issues.push("PARENT_NOT_PUBLISHED");
      if (parent.type === "simple" && parent.variations?.length)
        issues.push("SIMPLE_WITH_HISTORICAL_CHILDREN");
      if (!children.length) issues.push("NO_WOO_MEMBERS");
      return {
        woo_product_id: parent.id,
        name: parent.name,
        source_status: parent.status,
        type: parent.type,
        categories: {
          state: categoryState,
          source_csv: source,
          mapping,
          proposed_ids: proposedIds,
          verified_ids:
            categoryState === "VERIFIED_PATH_AND_PUBLIC_MEMBERSHIP"
              ? proposedIds
              : null,
          public_membership_ids: liveCats ? liveIds : null,
          public_status: live?.status ?? null,
          unsafe_csv_syntax: unsafeSyntax,
        },
        woo_members: items,
        historical_child_ids:
          parent.type === "simple"
            ? (parent.variations ?? []).map((v) => v.id)
            : [],
        sicar_candidate_rows: candidateOnly.map(summarizeRow),
        sicar_routes: [
          ...new Set(
            linkedRows.map((r) =>
              JSON.stringify([r.fields.departamento, r.fields.categoria]),
            ),
          ),
        ]
          .sort()
          .map((r) => JSON.parse(r)),
        issues,
        diagnostic_state: issues.length
          ? "MANUAL_REVIEW"
          : "IDENTITY_AND_CATEGORIES_CHECKED_NOT_APPROVED",
        send_allowed: false,
        delete_ids: [],
      };
    })
    .sort((a, b) => a.woo_product_id - b.woo_product_id);
  return {
    version: "m9-web-family-review-1",
    purpose: "READ_ONLY_EVIDENCE_NOT_IMPORTABLE",
    scope: "PILOT_PARENTS_WITH_ALL_EXPORTED_WOO_CHILDREN",
    woo_writes_enabled: false,
    inventory_included: false,
    taxonomy_scope: taxonomy.scope,
    taxonomy_captured_at: taxonomy.captured_at,
    categories,
    families,
    counts: {
      families: families.length,
      categories: categories.length,
      categories_verified: families.filter(
        (f) => f.categories.verified_ids !== null,
      ).length,
      woo_members: families.reduce((n, f) => n + f.woo_members.length, 0),
      outside_pilot: families.reduce(
        (n, f) => n + f.woo_members.filter((i) => !i.in_pilot).length,
        0,
      ),
      exact_members: families.reduce(
        (n, f) =>
          n +
          f.woo_members.filter((i) => i.state === "EXACT_CANONICAL_LINK")
            .length,
        0,
      ),
      unresolved_members: families.reduce(
        (n, f) =>
          n +
          f.woo_members.filter((i) => i.state !== "EXACT_CANONICAL_LINK")
            .length,
        0,
      ),
      families_requiring_review: families.filter((f) => f.issues.length).length,
    },
  };
}

export async function verifiedFile(directory, name) {
  const hashes = JSON.parse(await readFile(resolve(directory, "sha256.json")));
  const raw = await readFile(resolve(directory, name));
  if (hashes[name] !== sha256(raw))
    throw new Error(`SOURCE_HASH_MISMATCH:${name}`);
  return { raw, data: JSON.parse(raw) };
}
async function main() {
  const [contentDir, wooPath, reportDir, taxonomyDir, out] =
    process.argv.slice(2);
  if (process.argv.length !== 7)
    throw new Error(
      "Usage: CONTENT_DIR WOO_JSON REPORT_DIR TAXONOMY_DIR NEW_OUT",
    );
  const content = await verifiedFile(contentDir, "contenido.json"),
    rows = await verifiedFile(reportDir, "filas.json"),
    manifest = await verifiedFile(reportDir, "manifest.json"),
    taxonomy = await verifiedFile(taxonomyDir, "taxonomy.json");
  const woo = await readFile(wooPath);
  if (
    sha256(woo) !== manifest.data.woo_sha256 ||
    sha256(woo) !== content.data.sources.woo_sha256 ||
    sha256(content.raw) !== taxonomy.data.content_sha256
  )
    throw new Error("CROSS_SOURCE_HASH_MISMATCH");
  const report = reviewWebFamilies(
    content.data,
    JSON.parse(woo),
    rows.data,
    taxonomy.data,
  );
  report.sources = {
    content_sha256: sha256(content.raw),
    woo_sha256: sha256(woo),
    rows_sha256: sha256(rows.raw),
    manifest_sha256: sha256(manifest.raw),
    taxonomy_sha256: sha256(taxonomy.raw),
    sicar_sha256: manifest.data.sicar_sha256,
  };
  const labels = {
    families: "Familias revisadas",
    categories: "Categorías Woo consultadas",
    categories_verified: "Familias con categorías verificadas por ID",
    woo_members: "Miembros Woo completos",
    outside_pilot: "Miembros conservados fuera del piloto",
    exact_members: "Vínculos exactos con SICAR",
    unresolved_members: "Miembros pendientes de conciliación",
    families_requiring_review: "Familias con pendientes",
  };
  const issueLabels = {
    CATEGORY_REVIEW: "Revisar categorías",
    UNRESOLVED_WOO_MEMBERS: "Variantes Woo pendientes",
    UNRESOLVED_SICAR_CANDIDATES: "Candidatos SICAR pendientes",
    MULTIPLE_SICAR_SECTIONS: "Secciones distintas",
    PARENT_NOT_PUBLISHED: "Padre no publicado",
    SIMPLE_WITH_HISTORICAL_CHILDREN: "Hijos históricos",
    NO_WOO_MEMBERS: "Sin miembros",
  };
  const lines = [
    "# Categorías y familias web — revisión de sólo lectura",
    "",
    "No es un archivo importable ni una aprobación de envío. No se modificó WooCommerce, staging, producción ni inventario.",
    "",
    ...Object.entries(report.counts).map(([k, v]) => `- ${labels[k]}: ${v}`),
    "",
    "Se conservan todos los miembros Woo, incluidos los que no están en el piloto. Los casos sin vínculo confirmado siguen en revisión; no se borran ni se crean automáticamente. Departamento/sección SICAR se conserva por código y no se convierte en categoría web.",
    "",
    "Los IDs verificados coinciden por ruta completa del CSV y pertenencia pública en la captura indicada. Son evidencia temporal; una nueva exportación o cambios posteriores requieren repetir el análisis. No verifican todavía la clasificación editorial elegida en fichas humanas.",
    "",
    "| Woo padre | Nombre | Miembros Woo | Fuera del piloto | Sin vínculo confirmado | Categorías | Pendientes |",
    "| --- | --- | ---: | ---: | ---: | --- | --- |",
    ...report.families.map(
      (f) =>
        `| ${f.woo_product_id} | ${f.name.replace(/[|\r\n<>[\]!*_`]/g, " ")} | ${f.woo_members.length} | ${f.woo_members.filter((i) => !i.in_pilot).length} | ${f.woo_members.filter((i) => i.state !== "EXACT_CANONICAL_LINK").length} | ${f.categories.verified_ids?.join(", ") ?? "Revisión"} | ${f.issues.map((i) => issueLabels[i]).join(", ") || "Revisión editorial y aprobación pendientes"} |`,
    ),
  ];
  const files = {
    "familias.json": JSON.stringify(report, null, 2) + "\n",
    "resumen.md": lines.join("\n") + "\n",
  };
  await mkdir(out);
  for (const [name, raw] of Object.entries(files))
    await writeFile(resolve(out, name), raw, { flag: "wx" });
  await writeFile(
    resolve(out, "sha256.json"),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(files).map(([name, raw]) => [name, sha256(raw)]),
      ),
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(report.counts));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
