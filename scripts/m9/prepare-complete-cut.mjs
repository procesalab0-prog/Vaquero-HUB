import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { auditStagedCatalog } from "./audit-staged-catalog.mjs";
import { sourceDelta } from "./prepare-source-delta.mjs";
import { reviewDistinctNamedParents } from "./review-distinct-named-parents.mjs";
import { stable } from "./woo-test/plan.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const json = (s) => JSON.stringify(s, null, 2) + "\n";
const key = (s) =>
  s
    .toLowerCase()
    .replace(
      /[áéíóúüñ]/g,
      (c) => ({ á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n" })[c],
    );
const labels = {
  STAGED_IDENTICAL: "Ya cargadas y coincidentes",
  DESTINATION_NAME_REVIEW: "Pendientes de revisión por nombre igual",
  DISPLAY_ONLY_REVIEW: "Productos de exhibición",
  PENDING_CONFLICT: "Diferencias por revisar",
  PENDING_DUPLICATE_WOO_BASE: "Código base repetido en Woo",
  PENDING_MATCH_EXACT_VARIANT: "Coincidencia con controles pendientes",
  PENDING_SICAR_ONLY: "Sólo SICAR: identidad y agrupación pendientes",
  PENDING_SPECIAL_SUFFIX: "Talla o sufijo por aclarar",
  PENDING_VARIANT_NOT_PUBLISHED: "Variación ausente o no publicada",
  UNCHANGED: "Sin cambios",
  INVENTORY_ONLY_EXCLUDED: "Cambios de inventario excluidos",
  RECONCILIATION_CHANGE_ONLY: "Cambió la conciliación, no los datos SICAR",
  CATALOG_CHANGE_MANUAL_REVIEW: "Cambios de datos del catálogo",
  PUBLIC_PRICE_CHANGE_REVIEW: "Cambios de precio público",
  NEW_MANUAL_REVIEW: "Altas nuevas",
};
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const count = (rows, field) =>
  Object.fromEntries(
    [...new Set(rows.map((r) => r[field]))]
      .sort()
      .map((k) => [k, rows.filter((r) => r[field] === k).length]),
  );

// This is a review ledger, never an import payload. Names cannot grant identity.
export function reviewDestinationNames(candidates, destination, woo) {
  if (
    destination.project_id !== "zsezjtswqeijboezvado" ||
    !Array.isArray(destination.parents)
  )
    throw Error("STAGING_PARENTS_REQUIRED");
  const parents = new Map(woo.products.map((p) => [p.id, p]));
  const reviews = new Map(
    reviewDistinctNamedParents(woo).map((p) => [p.woo_product_id, p]),
  );
  const seen = new Set(),
    managed = new Set();
  for (const p of destination.parents) {
    if (
      !p.product_id ||
      seen.has(p.product_id) ||
      typeof p.search_name !== "string"
    )
      throw Error("INVALID_DESTINATION_PARENT");
    seen.add(p.product_id);
    if (p.woo_id !== null) {
      if (!parents.has(p.woo_id) || managed.has(p.woo_id))
        throw Error("INVALID_DESTINATION_WOO_IDENTITY");
      managed.add(p.woo_id);
    }
  }
  const groups = new Map();
  for (const r of candidates) {
    if (
      !parents.has(r.woo_product_id) ||
      r.product_name !== parents.get(r.woo_product_id).name
    )
      throw Error("CANDIDATE_NAME_SOURCE_MISMATCH");
    groups.set(r.woo_product_id, [...(groups.get(r.woo_product_id) ?? []), r]);
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .map(([id, rows]) => {
      const source = parents.get(id),
        proof = reviews.get(id),
        reasons = [];
      const peers = destination.parents.filter(
        (p) => p.search_name === key(source.name),
      );
      if (managed.has(id))
        reasons.push("PARENT_ALREADY_MANAGED_REPLAN_REQUIRED");
      if (!peers.length)
        reasons.push("NAME_COLLISION_NO_LONGER_PRESENT_REPLAN_REQUIRED");
      if (proof.state !== "DISTINCT_LITERAL_BASES")
        reasons.push("SOURCE_BASE_IDENTITY_REVIEW");
      for (const p of peers) {
        if (p.woo_id === null) reasons.push("UNMANAGED_DESTINATION_PARENT");
        else if (
          !proof.peers.some(
            (s) => s.woo_product_id === p.woo_id && s.name === p.name,
          )
        )
          reasons.push("DESTINATION_NAME_SOURCE_DIVERGED");
      }
      const peerEvidence = peers.map((p) => ({
        ...p,
        base_original: parents.get(p.woo_id)?.short_description ?? null,
      }));
      return {
        woo_product_id: id,
        name: source.name,
        base_original: source.short_description,
        barcodes: rows.map((r) => r.barcode).sort(),
        rows: rows.length,
        state: reasons.length
          ? "MANUAL_IDENTITY_REVIEW"
          : "DISTINCT_MANAGED_IDENTITIES_EVIDENCED",
        reasons: [...new Set(reasons)].sort(),
        peers: peerEvidence,
        source_proof: proof,
        destination_sha256: sha(stable(peerEvidence)),
        candidate_sha256: sha(stable(rows)),
        next_step: reasons.length
          ? "REVIEW_WITH_OWNER_OR_SOURCE"
          : "PROTECTED_DESTINATION_REVIEW_AND_FRESH_PLAN_REQUIRED",
        import_allowed: false,
        send_allowed: false,
        commercial_approval: false,
      };
    });
}

export function completeCut(
  previous,
  current,
  snapshot,
  woo,
  destination,
  reserved,
  excluded = [],
) {
  if (
    !Array.isArray(current) ||
    !current.length ||
    woo.pagination_complete !== true
  )
    throw Error("COMPLETE_SOURCES_REQUIRED");
  const audit = auditStagedCatalog(snapshot, current);
  if (!audit.summary.inventory_clean) throw Error("INVENTORY_NOT_EXCLUDED");
  const destinationById = new Map(
    destination.parents.map((p) => [p.product_id, p]),
  );
  for (const r of snapshot.rows)
    if (destinationById.get(r.product_id)?.woo_id !== r.current.woo_product_id)
      throw Error("DESTINATION_SNAPSHOT_IDENTITY_MISMATCH");
  const delta = sourceDelta(previous, current),
    deltaByCode = new Map(delta.items.map((r) => [r.barcode, r]));
  const audited = new Map(audit.results.map((r) => [r.barcode, r]));
  if (
    audited.size !== audit.results.length ||
    audit.results.some((r) =>
      r.reasons.some((x) =>
        [
          "DUPLICATE_STAGED_BARCODE",
          "DUPLICATE_OR_INVALID_VARIANT_ID",
        ].includes(x),
      ),
    )
  )
    throw Error("DUPLICATE_STAGING_IDENTITY");
  const byCode = new Map();
  for (const r of current)
    byCode.set(r.barcode, [...(byCode.get(r.barcode) ?? []), r]);
  const holds = new Map();
  for (const r of excluded) {
    if (
      !byCode.has(r.barcode) ||
      holds.has(r.barcode) ||
      !Array.isArray(r.reasons) ||
      r.reasons.some((s) => typeof s !== "string")
    )
      throw Error("INVALID_PREPARATION_HOLDS");
    holds.set(r.barcode, r.reasons);
  }
  const names = reviewDestinationNames(reserved, destination, woo);
  const wooById = new Map(woo.products.map((p) => [p.id, p]));
  const stagedByCode = new Map(
    snapshot.rows.map((r) => [r.current.barcode, r]),
  );
  const reservedByCode = new Map();
  for (const r of reserved) {
    const source = byCode.get(r.barcode);
    if (
      reservedByCode.has(r.barcode) ||
      source?.length !== 1 ||
      source[0].product_id !== r.woo_product_id ||
      source[0].variation_id !== r.woo_variation_id ||
      audited.has(r.barcode)
    )
      throw Error("RESERVED_IDENTITY_STALE");
    reservedByCode.set(r.barcode, r.woo_product_id);
  }
  const items = [...byCode]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([barcode, rows]) => {
      const r = rows[0],
        a = audited.get(barcode),
        d = deltaByCode.get(barcode);
      const nameChanged =
        !!a &&
        stagedByCode.get(barcode).current.product_name !==
          wooById.get(r.product_id)?.name;
      let state;
      if (rows.length !== 1) state = "DUPLICATE_SOURCE_MANUAL_REVIEW";
      else if (a?.reasons.includes("CATALOG_DIFFERS_FROM_APPLIED_ROW"))
        state = "DESTINATION_EDIT_REVIEW";
      else if (a?.state === "REVIEW_REQUIRED")
        state = "STAGED_SOURCE_CHANGE_REVIEW";
      else if (nameChanged) state = "STAGED_WOO_NAME_CHANGE_REVIEW";
      else if (a) state = "STAGED_IDENTICAL";
      else if (reservedByCode.has(barcode)) state = "DESTINATION_NAME_REVIEW";
      else if (r.display_only) state = "DISPLAY_ONLY_REVIEW";
      else state = "PENDING_" + r.classification;
      return {
        barcode,
        source_rows: rows.length,
        description: r.description,
        department: r.fields.departamento,
        section: r.fields.categoria,
        classification: r.classification,
        state,
        variant_id: a?.variant_id ?? null,
        product_id: a?.product_id ?? null,
        woo_product_id: r.product_id,
        woo_variation_id: r.variation_id,
        source_delta: d?.state ?? null,
        source_reasons: r.reasons,
        source_issues: r.issues,
        commercial_checks: r.commercial_checks,
        preparation_holds: holds.get(barcode) ?? [],
        audit_reasons: a?.reasons ?? [],
        woo_name_change_requires_review: nameChanged,
        differences: a?.differences ?? [],
        name_review_parent: reservedByCode.get(barcode) ?? null,
        import_allowed: false,
        send_allowed: false,
      };
    });
  const orphans = audit.results
    .filter((r) => !byCode.has(r.barcode))
    .map((r) => ({
      ...r,
      state: "ABSENT_SOURCE_NO_DELETE",
      delete_allowed: false,
    }));
  if (items.reduce((n, r) => n + r.source_rows, 0) !== current.length)
    throw Error("SOURCE_PARTITION_INCOMPLETE");
  const wooOnly = woo.products
    .filter(
      (p) =>
        !current.some(
          (r) =>
            (r.candidate_product_ids ?? []).includes(p.id) ||
            r.product_id === p.id,
        ),
    )
    .map((p) => ({
      woo_product_id: p.id,
      name: p.name,
      status: p.status,
      base_original: p.short_description,
      state: "WOO_ONLY_MANUAL_REVIEW",
      import_allowed: false,
      delete_allowed: false,
    }))
    .sort((a, b) => a.woo_product_id - b.woo_product_id);
  return {
    version: "m9-complete-cut-1",
    mode: "OFFLINE_READ_ONLY",
    automatic_import_allowed: false,
    inventory_included: false,
    woo_writes_allowed: false,
    production_allowed: false,
    summary: {
      source_rows: current.length,
      source_codes: items.length,
      staged_rows: snapshot.rows.length,
      exact_staged: audit.summary.exact_rows,
      staged_unchanged: items.filter((r) => r.state === "STAGED_IDENTICAL")
        .length,
      staged_review:
        items.filter((r) => r.variant_id && r.state !== "STAGED_IDENTICAL")
          .length + orphans.length,
      remaining_source_rows: items
        .filter((r) => !r.variant_id)
        .reduce((n, r) => n + r.source_rows, 0),
      states: count(items, "state"),
      source_changes: delta.counts,
      absent_staged: orphans.length,
      woo_only_parents: wooOnly.length,
      name_review_parents: names.length,
      name_review_rows: reserved.length,
      name_review_states: count(names, "state"),
      pending_preparation_holds: count(
        items
          .filter((r) => !r.variant_id)
          .flatMap((r) => r.preparation_holds.map((reason) => ({ reason }))),
        "reason",
      ),
      inventory_balances: snapshot.inventory_balances,
      inventory_movements: snapshot.inventory_movements,
    },
    ledger: items,
    absent_staged: orphans,
    name_reviews: names,
    woo_only: wooOnly,
    source_changes: delta.items.filter((r) => r.state !== "UNCHANGED"),
    gates: [
      "FRESH_AUTHENTICATED_SOURCES_BEFORE_OPERATION",
      "OWNER_APPROVAL_FOR_AMBIGUOUS_AND_SICAR_ONLY_FAMILIES",
      "PROTECTED_DESTINATION_REVIEW_FOR_NAME_COLLISIONS",
      "FRESH_DESTINATION_PLAN_BEFORE_ANY_STAGING_WRITE",
      "NO_STOCK_IMPORT_IN_THIS_PHASE",
      "NO_PRODUCTION_OR_WOO_WRITES",
    ],
  };
}

export async function prepareCompleteCut(configPath, out) {
  const config = JSON.parse(await readFile(configPath)),
    base = dirname(resolve(configPath)),
    inputs = {};
  async function load(name) {
    const entry = config.inputs[name];
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256))
      throw Error("PINNED_INPUT_REQUIRED:" + name);
    const raw = await readFile(resolve(base, entry.path));
    if (sha(raw) !== entry.sha256) throw Error("INPUT_CHANGED:" + name);
    inputs[name] = { sha256: sha(raw) };
    return JSON.parse(raw);
  }
  const data = {};
  for (const name of [
    "previous",
    "current",
    "snapshot",
    "woo",
    "destination",
    "reserved",
    "manifest",
  ])
    data[name] = await load(name);
  if (inputs.woo.sha256 !== data.manifest.woo_sha256)
    throw Error("WOO_MANIFEST_MISMATCH");
  if (config.inputs.excluded || config.inputs.preparation_inputs) {
    data.excluded = await load("excluded");
    const preparation = await load("preparation_inputs");
    const sources = Object.entries(preparation).filter(([p]) =>
      p.endsWith("/filas.json"),
    );
    if (sources.length !== 1 || sources[0][1] !== inputs.current.sha256)
      throw Error("PREPARATION_SOURCE_MISMATCH");
  }
  const result = completeCut(
    data.previous,
    data.current,
    data.snapshot,
    data.woo,
    data.destination,
    data.reserved.rows,
    data.excluded,
  );
  result.inputs = inputs;
  result.source_cut = {
    sicar_sha256: data.manifest.sicar_sha256,
    woo_sha256: data.manifest.woo_sha256,
    rules_version: data.manifest.rules_version,
    woo_is_fresh: false,
  };
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Preparación del catálogo completo</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:20px;color:#182b32}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px;text-align:left}details{margin:16px 0;padding:12px;background:#f2f5f6}code{overflow-wrap:anywhere}</style><h1>Preparación del catálogo completo</h1><p>Reporte de sólo lectura. No carga productos, no cambia la tienda ni importa existencias. Woo procede del corte histórico; hay que renovarlo antes de operar.</p><p><b>${result.summary.source_rows}</b> filas SICAR revisadas. <b>${result.summary.exact_staged}</b> ya coinciden en Mi Tienda. <b>${result.summary.remaining_source_rows}</b> siguen pendientes. Esto mide catálogo, no avance global.</p><h2>Resultado por grupo</h2><table><tr><th>Grupo</th><th>Filas/códigos</th></tr>${Object.entries(
    result.summary.states,
  )
    .map(([k, v]) => `<tr><td>${escape(labels[k] ?? k)}</td><td>${v}</td></tr>`)
    .join(
      "",
    )}</table><h2>Cambios entre exportaciones SICAR 5 y 6</h2><ul>${Object.entries(
    result.summary.source_changes,
  )
    .map(([k, v]) => `<li>${escape(labels[k] ?? k)}: ${v}</li>`)
    .join(
      "",
    )}</ul><p>Estos cambios ya pertenecen a cortes históricos; no son cambios nuevos de hoy ni se aplican automáticamente.</p><h2>Productos con nombres iguales</h2><p>Los códigos e IDs se comparan por separado. La evidencia técnica no aprueba una carga; el control del destino sigue activo.</p>${result.name_reviews.map((r) => `<details><summary>${escape(r.name)} — ${r.rows} variantes — Woo ${r.woo_product_id}</summary><p>Base: <code>${escape(r.base_original)}</code>. Estado: ${escape(r.state)}.</p><p>Códigos SICAR: ${r.barcodes.map(escape).join(", ")}</p><table><tr><th>Woo existente</th><th>Base existente</th></tr>${r.peers.map((p) => `<tr><td>${escape(p.woo_id ?? "Sin vínculo gestionado")}</td><td>${escape(p.base_original ?? "Sin evidencia")}</td></tr>`).join("")}</table><p>${r.reasons.map(escape).join(", ")}</p></details>`).join("")}<h2>Sin candidato SICAR en el corte Woo</h2><p>${result.woo_only.length} productos web sin candidato en este reporte. No se agregan ni se borran automáticamente. El alcance incluye borradores y privados del corte histórico.</p><details><summary>Ver productos web para revisión</summary><table><tr><th>Woo</th><th>Producto</th><th>Estado</th></tr>${result.woo_only.map((p) => `<tr><td>${p.woo_product_id}</td><td>${escape(p.name)}</td><td>${escape(p.status)}</td></tr>`).join("")}</table></details><h2>Próximo corte</h2><p>Exportar SICAR y Woo de nuevo, verificar huellas y repetir esta preparación. Los cambios requieren revisión; ausencias nunca autorizan bajas. Los productos sólo SICAR permanecen incluidos en el alcance, pendientes de identidad y agrupación. No se inventan tallas ni códigos.</p><p>El detalle completo está en plan-completo.json, cambios-fuente.json y solo-woo.json. Las dudas de negocio continúan reunidas en el reporte anterior.</p></html>`;
  const files = {
    "plan-completo.json": json(result),
    "resumen.json": json(result.summary),
    "revision-nombres.json": json(result.name_reviews),
    "cambios-fuente.json": json(result.source_changes),
    "solo-woo.json": json(result.woo_only),
    "reporte.html": html,
  };
  await mkdir(out);
  for (const [name, value] of Object.entries(files))
    await writeFile(resolve(out, name), value, { flag: "wx" });
  await writeFile(
    resolve(out, "sha256.json"),
    json(
      Object.fromEntries(Object.entries(files).map(([n, v]) => [n, sha(v)])),
    ),
    { flag: "wx" },
  );
  return result.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4)
    throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT_DIR");
  console.log(await prepareCompleteCut(...process.argv.slice(2)));
}
