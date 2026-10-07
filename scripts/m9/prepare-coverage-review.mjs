import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { auditStagedCatalog } from "./audit-staged-catalog.mjs";
import { prepareSicarOnly } from "./prepare-sicar-only.mjs";
import { reviewSicarFamilies } from "./review-sicar-families.mjs";

const json = (v) => JSON.stringify(v, null, 2) + "\n";
const sha = (v) => createHash("sha256").update(v).digest("hex");
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const normalizedName = (v) => v.normalize("NFC").trim().toUpperCase();

// Prioritize human review; never turn a numerical target into identity approval.
export function coverageReview(
  rows,
  appliedRows,
  snapshot,
  taxonomy,
  target = 50,
  holds = [],
) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(appliedRows))
    throw Error("COMPLETE_SOURCE_REQUIRED");
  if (!Number.isInteger(target) || target < 1 || target > 99)
    throw Error("INVALID_COVERAGE_TARGET");
  if (snapshot.inventory_balances !== 0 || snapshot.inventory_movements !== 0)
    throw Error("INVENTORY_MUST_REMAIN_EMPTY");
  if (!Array.isArray(snapshot.products) || !Array.isArray(taxonomy.paths))
    throw Error("COMPLETE_DESTINATION_AND_TAXONOMY_REQUIRED");
  const codes = new Set(),
    applied = new Map();
  for (const r of appliedRows) {
    if (applied.has(r.barcode)) throw Error("DUPLICATE_APPLIED_REFERENCE");
    applied.set(r.barcode, r);
  }
  for (const r of rows) {
    if (
      typeof r.barcode !== "string" ||
      !r.barcode ||
      codes.has(r.barcode) ||
      r.barcode !== r.fields?.["clave1 *"] ||
      r.description !== r.fields?.["descripción *"]
    )
      throw Error("NON_UNIQUE_OR_CHANGED_SOURCE_IDENTITY");
    codes.add(r.barcode);
    const previous = applied.get(r.barcode);
    if (
      !previous ||
      JSON.stringify(previous.fields) !== JSON.stringify(r.fields) ||
      previous.description !== r.description
    )
      throw Error("APPLIED_REFERENCE_NOT_SAME_SICAR_CUT");
  }
  if (applied.size !== codes.size)
    throw Error("APPLIED_REFERENCE_SCOPE_CHANGED");
  const audit = auditStagedCatalog(snapshot, appliedRows);
  if (audit.summary.review_rows || !audit.summary.inventory_clean)
    throw Error("STAGED_CATALOG_CHANGED");
  const productIds = new Set(),
    productNames = new Set();
  for (const p of snapshot.products) {
    if (
      typeof p.id !== "string" ||
      productIds.has(p.id) ||
      typeof p.name !== "string"
    )
      throw Error("INVALID_DESTINATION_PRODUCTS");
    productIds.add(p.id);
    productNames.add(normalizedName(p.name));
  }
  if (snapshot.rows.some((r) => !productIds.has(r.product_id)))
    throw Error("INCOMPLETE_DESTINATION_PRODUCTS");
  const staged = new Set(snapshot.rows.map((r) => r.current.barcode));
  const review = prepareSicarOnly(rows);
  if (review.records.some((r) => staged.has(r.barcode)))
    throw Error("SICAR_ONLY_ALREADY_STAGED_REQUIRES_REVIEW");
  const families = reviewSicarFamilies(review);
  if (!Array.isArray(holds)) throw Error("INVALID_HOLDS");
  const heldCodes = new Set();
  for (const hold of holds) {
    const source = rows.find((r) => r.barcode === hold.barcode);
    if (
      !source ||
      heldCodes.has(hold.barcode) ||
      hold.description !== source.description ||
      typeof hold.reason !== "string" ||
      !hold.reason.trim()
    )
      throw Error("INVALID_OR_STALE_HOLD");
    heldCodes.add(hold.barcode);
  }
  const taxHolds = new Set(
    taxonomy.paths.filter((p) => p.needs_review).flatMap((p) => p.barcodes),
  );
  const exactDescriptions = new Map();
  for (const r of rows)
    exactDescriptions.set(r.description, [
      ...(exactDescriptions.get(r.description) ?? []),
      r.barcode,
    ]);
  const proposedMembers = new Map();
  for (const r of rows) {
    const match = /^(.+)T\./.exec(r.description);
    if (match)
      proposedMembers.set(match[1], [
        ...(proposedMembers.get(match[1]) ?? []),
        r.barcode,
      ]);
  }
  const cases = families.cases.map((c) => {
    const issues = new Set(c.issues);
    if (c.members.some((r) => heldCodes.has(r.barcode)))
      issues.add("EXISTING_MANUAL_HOLD");
    if (c.members.some((r) => taxHolds.has(r.barcode)))
      issues.add("TAXONOMY_PATH_REVIEW");
    if (productNames.has(normalizedName(c.product_name_proposed)))
      issues.add("DESTINATION_NAME_REVIEW");
    if (c.kind === "EXPLICIT_T_PROPOSAL") {
      const members = new Set(c.members.map((r) => r.barcode));
      if ((exactDescriptions.get(c.product_name_proposed) ?? []).length)
        issues.add("BASE_RECORD_REQUIRES_REVIEW");
      if (
        (proposedMembers.get(c.product_name_proposed) ?? []).some(
          (code) => !members.has(code),
        )
      )
        issues.add("FAMILY_SCOPE_REVIEW");
    }
    return { ...c, issues: [...issues].sort(), send_allowed: false };
  });
  const eligible = cases
    .filter((c) => c.kind === "EXPLICIT_T_PROPOSAL" && !c.issues.length)
    .sort(
      (a, b) =>
        b.members.length - a.members.length || order(a.case_id, b.case_id),
    );
  const requiredTotal = Math.floor((rows.length * target) / 100) + 1;
  const missing = Math.max(0, requiredTotal - staged.size);
  const selected = [];
  let selectedRows = 0;
  for (const c of eligible) {
    if (selectedRows >= missing) break;
    selected.push(c);
    selectedRows += c.members.length;
  }
  const selectedIds = new Set(selected.map((c) => c.case_id));
  const byCode = new Map(
    cases.flatMap((c) => c.members.map((r) => [r.barcode, c])),
  );
  const partition = rows
    .map((r) => {
      const c = byCode.get(r.barcode);
      return {
        barcode: r.barcode,
        classification: r.classification,
        bucket: staged.has(r.barcode)
          ? "STAGED_VERIFIED"
          : c
            ? selectedIds.has(c.case_id)
              ? "PRIORITY_HUMAN_REVIEW"
              : c.kind === "UNSPLIT_RECORD"
                ? "SICAR_UNSPLIT_REVIEW"
                : c.issues.length
                  ? "SICAR_ADDITIONAL_REVIEW"
                  : "SICAR_NEXT_HUMAN_REVIEW"
            : "WOO_REVIEW",
        case_id: c?.case_id ?? null,
        import_allowed: false,
        send_allowed: false,
      };
    })
    .sort((a, b) => order(a.barcode, b.barcode));
  const buckets = {};
  for (const r of partition) buckets[r.bucket] = (buckets[r.bucket] ?? 0) + 1;
  const summary = {
    source_rows: rows.length,
    staged_rows: staged.size,
    actual_coverage_percent: (staged.size / rows.length) * 100,
    target_strictly_above_percent: target,
    required_staged_rows: requiredTotal,
    additional_rows_required: missing,
    priority_cases: selected.length,
    priority_rows: selectedRows,
    maximum_rows_with_one_fewer_priority_cases:
      selectedRows - (selected.at(-1)?.members.length ?? 0),
    projected_rows_if_all_confirmed_and_destination_accepts:
      staged.size + selectedRows,
    projected_coverage_percent:
      ((staged.size + selectedRows) / rows.length) * 100,
    sufficient_proposals_for_target: selectedRows >= missing,
    proposals_without_additional_flags: eligible.length,
    proposal_rows_without_additional_flags: eligible.reduce(
      (n, c) => n + c.members.length,
      0,
    ),
    approved_new_rows: 0,
    imported_new_rows: 0,
    buckets,
  };
  return {
    version: "m9-coverage-human-review-1",
    summary,
    audit,
    latest_source_audit: auditStagedCatalog(snapshot, rows),
    review,
    cases,
    priority: selected,
    partition,
    templates: families.templates.filter((t) =>
      selectedIds.has(
        cases.find((c) => "sicar-" + c.case_id.slice(0, 40) === t.family_key)
          ?.case_id,
      ),
    ),
    import_allowed: false,
    send_allowed: false,
    inventory_included: false,
  };
}

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function coverageHtml(packet) {
  const s = packet.summary;
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Revisión para superar ${s.target_strictly_above_percent}%</title><style>body{font:16px system-ui;background:#f4f3ed;color:#17382d;max-width:1100px;margin:auto;padding:24px}header,article{background:white;padding:24px;border-radius:14px;margin:18px 0}h2{overflow-wrap:anywhere}p{line-height:1.6}table{border-collapse:collapse;width:100%}th,td{padding:10px;text-align:left;border-bottom:1px solid #ddd}.scroll{overflow:auto}.notice{background:#fff1ca;padding:18px}small{overflow-wrap:anywhere}summary{cursor:pointer;padding:16px 0}</style><header><h1>El siguiente bloque de catálogo</h1><p>Actualmente cargado: <b>${s.staged_rows} de ${s.source_rows} (${s.actual_coverage_percent.toFixed(2)}%)</b>.</p><p>Para superar ${s.target_strictly_above_percent}% faltan ${s.additional_rows_required} variantes. Estas ${s.priority_cases} propuestas reúnen ${s.priority_rows}.</p><p class="notice">No están cargadas ni aprobadas. Si se confirman todas y pasan la validación del destino, llegaríamos a ${s.projected_coverage_percent.toFixed(2)}%. Este porcentaje mide catálogo, no la terminación global del sistema.</p><p>Revisar cada modelo y sus tallas. Se conservan códigos de barras, departamentos, secciones y precio público SICAR. No se importan existencias ni se publica en Woo. Una respuesta general o el silencio no confirman las propuestas.</p></header>${packet.priority.map((c, i) => `<article><h2>${i + 1}. ${esc(c.product_name_proposed)}</h2><p>${esc(c.department)} / ${esc(c.section)} · ${c.members.length} variantes</p><p>¿Estos códigos pertenecen a un solo modelo y las tallas de la tabla son correctas? ¿Qué nombre debe verse en Mi Tienda? Si hay diferencias, indicar los códigos que deben separarse.</p><details><summary>Ver códigos, tallas y precios</summary><div class="scroll"><table><thead><tr><th>Código de barras</th><th>Descripción original</th><th>Talla propuesta</th><th>Precio público</th></tr></thead><tbody>${c.members.map((r) => `<tr><td>${esc(r.barcode)}</td><td>${esc(r.description)}</td><td>${esc(r.proposed.suffix)}</td><td>$${(r.retail_cents / 100).toFixed(2)}</td></tr>`).join("")}</tbody></table></div></details><p>Respuesta ${i + 1}: mismo modelo sí/no; tallas correctas sí/no; nombre; correcciones.</p><small>Expediente ${c.case_id} · evidencia ${c.evidence_sha256}</small></article>`).join("")}<footer><p>Los demás pendientes siguen conservados en la partición completa. Esta selección minimiza la cantidad de expedientes por revisar entre las propuestas sin observaciones adicionales; no aprueba identidades, nombres comerciales, publicación ni carga.</p></footer></html>`;
}

export async function prepareCoverageReview(configPath, output) {
  const config = JSON.parse(await readFile(configPath)),
    inputs = {};
  for (const key of [
    "rows",
    "applied",
    "snapshot",
    "taxonomy",
    "manifest",
    "holds",
  ]) {
    const input = config.inputs?.[key];
    if (!input || !/^[a-f0-9]{64}$/.test(input.sha256))
      throw Error("PINNED_INPUT_REQUIRED");
    const bytes = await readFile(resolve(dirname(configPath), input.path));
    if (sha(bytes) !== input.sha256) throw Error("INPUT_HASH_CHANGED");
    inputs[key] = JSON.parse(bytes);
  }
  if (
    !/^[a-f0-9]{64}$/.test(inputs.manifest.sicar_sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(inputs.manifest.woo_sha256 ?? "")
  )
    throw Error("SOURCE_HASH_REQUIRED");
  const packet = coverageReview(
    inputs.rows,
    inputs.applied,
    inputs.snapshot,
    inputs.taxonomy,
    config.target_percent,
    inputs.holds,
  );
  packet.review.sources = {
    sicar_sha256: inputs.manifest.sicar_sha256,
    woo_sha256: inputs.manifest.woo_sha256,
    rows_sha256: config.inputs.rows.sha256,
  };
  packet.inputs = config.inputs;
  const files = {
    "meta.json": json(packet.summary),
    "auditoria-aplicada.json": json(packet.audit),
    "auditoria-ultimo-woo.json": json(packet.latest_source_audit),
    "solo-sicar.json": json(packet.review),
    "familias-completas.json": json(packet.cases),
    "particion.json": json(packet.partition),
    "revision-prioritaria.json": json({
      version: packet.version,
      sources: packet.review.sources,
      cases: packet.priority,
      import_allowed: false,
      send_allowed: false,
    }),
    "plantillas-pendientes.json": json(packet.templates),
    "revision.html": coverageHtml(packet),
    "consulta.txt": `Para avanzar con los productos que sólo están en SICAR, falta confirmar los ${packet.summary.priority_cases} modelos del documento adjunto. Son ${packet.summary.priority_rows} códigos en total.\n\nRevisen cada número: ¿es un solo modelo y están bien sus tallas? Indiquen también el nombre que debe aparecer. Si hay que separar alguno, díganos cuáles códigos. Se pueden responder todos los números en un solo mensaje. No hace falta volver a escribir todos los códigos si la tabla está correcta.\n\nTodavía son propuestas: no se han cargado ni publicado. No necesitamos que inventen fotos, costos o existencias.\n`,
    "procedencia.json": json({
      inputs: packet.inputs,
      source_hashes: packet.review.sources,
      write_allowed: false,
      database_plan_included: false,
    }),
  };
  files["sha256.json"] = json(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])),
  );
  await mkdir(output);
  for (const [name, value] of Object.entries(files))
    await writeFile(resolve(output, name), value, { flag: "wx" });
  return packet.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [config, output] = process.argv.slice(2);
  if (!config || !output) throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT");
  console.log(await prepareCoverageReview(resolve(config), resolve(output)));
}
