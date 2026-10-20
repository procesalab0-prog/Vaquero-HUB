import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sourceDelta } from "./prepare-source-delta.mjs";
import { compareWooSources } from "./prepare-woo-refresh.mjs";
import { digest } from "./acceleration.mjs";

const sha = (x) => createHash("sha256").update(x).digest("hex");
const json = (x) => JSON.stringify(x, null, 2) + "\n";
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function cents(s) {
  if (typeof s !== "string" || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const n = BigInt(w) * 100n + BigInt(f.padEnd(2, "0"));
  return n > 0n && n <= 100000000n ? Number(n) : null;
}
const validStock = (s) =>
  typeof s === "string" && /^\d+(\.0{1,3})?$/.test(s) && Number(s) > 0;
const text = (x) => typeof x === "string" && x.length > 0 && x === x.trim();
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export function renewedPilot({
  previousRows,
  currentRows,
  previousWoo,
  currentWoo,
  snapshot,
  phasePlan,
  limit = 12,
  maxPerParent = 3,
}) {
  if (
    snapshot.project_id !== "zsezjtswqeijboezvado" ||
    phasePlan.project_id !== snapshot.project_id ||
    phasePlan.production_allowed !== false ||
    snapshot.managed_count !== snapshot.rows?.length ||
    !snapshot.control?.enabled
  )
    throw Error("GUARDED_COMPLETE_STAGING_CONTEXT_REQUIRED");
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20 ||
    !Number.isInteger(maxPerParent) ||
    maxPerParent < 1 ||
    maxPerParent > 3
  )
    throw Error("SMALL_PILOT_SCOPE_REQUIRED");
  const delta = sourceDelta(previousRows, currentRows),
    woo = compareWooSources(previousWoo, currentWoo, snapshot.rows);
  const source = new Map(),
    dest = new Map(),
    reviewed = new Map(),
    parents = new Map(currentWoo.products.map((p) => [p.id, p]));
  for (const r of currentRows) {
    if (
      !text(r.barcode) ||
      source.has(r.barcode) ||
      r.barcode !== r.fields?.["clave1 *"] ||
      r.description !== r.fields?.["descripción *"]
    )
      throw Error("DUPLICATE_OR_NONLITERAL_SOURCE");
    source.set(r.barcode, r);
  }
  const ids = new Set();
  for (const r of snapshot.rows) {
    if (!text(r.barcode) || dest.has(r.barcode) || ids.has(r.variant_id))
      throw Error("DUPLICATE_DESTINATION_IDENTITY");
    dest.set(r.barcode, r);
    ids.add(r.variant_id);
  }
  for (const r of phasePlan.ledger) {
    if (reviewed.has(r.barcode)) throw Error("DUPLICATE_PHASE_IDENTITY");
    reviewed.set(r.barcode, r);
  }
  const wooChanged = new Set(
    woo.items
      .filter(
        (r) => !["UNCHANGED", "INVENTORY_ONLY_EXCLUDED"].includes(r.state),
      )
      .map((r) => r.woo_product_id),
  );
  const candidates = [],
    excluded = [],
    impact = [];
  for (const [barcode, s] of source) {
    const d = dest.get(barcode),
      p = reviewed.get(barcode),
      f = s.fields;
    if (d) {
      const differences = Object.entries({
        barcode,
        description: s.description,
        department: f.departamento,
        section: f.categoria,
        price_cents: cents(f.precio1),
      })
        .filter(([k, v]) => d.current[k] !== v)
        .map(([k]) => k);
      if (differences.length || !d.stored_matches)
        impact.push({
          barcode,
          variant_id: d.variant_id,
          product_id: d.product_id,
          state: "DESTINATION_OR_SOURCE_REVIEW",
          differences,
          write_allowed: false,
        });
    }
    const reasons = [];
    // Owner decision of 2026-10-05 covers the amartigones; the fresh export
    // identifies three listings, 37101/37102/37103. All stay outside this pilot.
    // This is a conservative pilot hold, not a new association or web edit.
    if ([37101, 37102, 37103].includes(s.product_id))
      reasons.push("OWNER_DISPLAY_ONLY_HOLD_2026_10_05");
    if (
      !d ||
      !p ||
      p.stage !== "REVIEWED" ||
      p.variant_id !== d.variant_id ||
      p.product_id !== d.product_id
    )
      reasons.push("OUTSIDE_PREVIOUS_REVIEWED_SCOPE");
    if (
      d &&
      (!d.allowlisted ||
        !d.review_matches ||
        !d.stored_matches ||
        !d.barcode_matches ||
        !d.is_active ||
        d.unit_code !== "PIECE" ||
        d.provisional ||
        d.current.cost_cents !== null)
    )
      reasons.push("LIVE_REVIEW_OR_CATALOG_CHANGED");
    if (
      s.classification !== "MATCH_EXACT_VARIANT" ||
      s.manual_review ||
      s.issues?.length ||
      s.commercial_checks?.length ||
      s.display_only
    )
      reasons.push("SOURCE_RECONCILIATION_REVIEW");
    if (!validStock(f.existencia))
      reasons.push("NO_POSITIVE_SOURCE_STOCK_EVIDENCE");
    if (
      f.unidad !== "PIEZA" ||
      f["(s/n) inventariable"] !== "s" ||
      f["(s/n) mostrar en ventas"] !== "s" ||
      ["(s/n) granel", "(s/n) receta", "(s/n) lotes"].some((k) => f[k] !== "n")
    )
      reasons.push("OPERATING_MODE_REVIEW");
    if (d && impact.some((r) => r.barcode === barcode))
      reasons.push("SOURCE_CATALOG_CHANGED");
    if (
      d &&
      (d.current.woo_product_id !== s.product_id ||
        (d.current.woo_variation_id ?? null) !== (s.variation_id ?? null))
    )
      reasons.push("WOO_LINK_CHANGED");
    const parent = parents.get(s.product_id),
      variant =
        s.variation_id == null
          ? parent
          : parent?.variations.find((v) => v.id === s.variation_id);
    if (
      !parent ||
      parent.status !== "publish" ||
      !variant ||
      variant.status !== "publish" ||
      cents(variant.source_fields?.["Precio normal"] ?? variant.price) !==
        cents(f.precio1) ||
      variant.sale_price ||
      parent.sale_price
    )
      reasons.push("WEB_STATE_PRICE_OR_PROMOTION_REVIEW");
    if (wooChanged.has(s.product_id))
      reasons.push("WOO_SOURCE_CHANGED_REVIEW_FIRST");
    const sourceAttributes = Object.fromEntries(
      (s.attributes ?? []).map((a) => [
        { Talla: "TALLA", Color: "COLOR", Largo: "LARGO" }[a.name] ?? a.name,
        a.value,
      ]),
    );
    if (d && digest(d.current.attributes ?? {}) !== digest(sourceAttributes))
      reasons.push("SOURCE_ATTRIBUTES_CHANGED");
    if (!text(parent?.description) || !text(parent?.images))
      reasons.push("WEB_CONTENT_INCOMPLETE");
    if (d && parent?.name !== d.current.product_name)
      reasons.push("WEB_DESTINATION_NAME_REVIEW");
    if (reasons.length) {
      excluded.push({ barcode, reasons });
      continue;
    }
    candidates.push({
      barcode,
      variant_id: d.variant_id,
      product_id: d.product_id,
      product_name: parent.name,
      source_description: s.description,
      department: f.departamento,
      section: f.categoria,
      attributes: d.current.attributes,
      public_price_cents: cents(f.precio1),
      cost_cents: null,
      woo_product_id: parent.id,
      woo_variation_id: s.variation_id,
      source_stock_observed: f.existencia,
      source_warehouse: "default",
      source_stock_is_importable: false,
      photos_source: parent.images,
      description_source: parent.description,
      quantity_to_import: null,
      reserved_to_import: null,
      activation_allowed: false,
      web_writes_allowed: false,
    });
  }
  candidates.sort((a, b) => cmp(a.barcode, b.barcode));
  const selected = [],
    chosen = new Set(),
    perParent = new Map();
  function choose(r) {
    if (
      !r ||
      chosen.has(r.barcode) ||
      selected.length >= limit ||
      (perParent.get(r.woo_product_id) ?? 0) >= maxPerParent
    )
      return;
    selected.push(r);
    chosen.add(r.barcode);
    perParent.set(r.woo_product_id, (perParent.get(r.woo_product_id) ?? 0) + 1);
  }
  choose(candidates.find((r) => r.barcode === "2396")); // previously physically scanned label, if still eligible
  for (const department of [
    ...new Set(candidates.map((r) => r.department)),
  ].sort(cmp))
    choose(candidates.find((r) => r.department === department));
  for (const section of [...new Set(candidates.map((r) => r.section))].sort(
    cmp,
  ))
    choose(candidates.find((r) => r.section === section));
  for (const r of candidates) choose(r);
  return {
    version: "m9-renewed-pilot-1",
    mode: "OFFLINE_READ_ONLY",
    project_id: snapshot.project_id,
    production_allowed: false,
    activation_allowed: false,
    inventory_import_allowed: false,
    woo_writes_allowed: false,
    source_delta: delta,
    woo_comparison: woo,
    catalogue_impacts: impact,
    source_absences_no_delete: snapshot.rows
      .filter((r) => !source.has(r.barcode))
      .map((r) => ({
        barcode: r.barcode,
        variant_id: r.variant_id,
        delete_allowed: false,
      })),
    summary: {
      source_codes: source.size,
      staged_codes: dest.size,
      eligible_reviewed_candidates: candidates.length,
      selected_codes: selected.length,
      selected_woo_parents: perParent.size,
      excluded_from_pilot: excluded.length,
      catalogue_impacts: impact.length,
      source_changes: delta.counts,
      woo_changes: woo.summary,
    },
    pilot: {
      identity_sha256: digest(
        selected.map(({ barcode, variant_id, product_id }) => ({
          barcode,
          variant_id,
          product_id,
        })),
      ),
      selection:
        "2396 when eligible, department/section coverage, literal barcode order; max 3 per Woo parent",
      partial_family_scope: true,
      replace_woo_family_allowed: false,
      stock_location_confirmed: false,
      live_sale_authorized: false,
      steps: [
        "Confirmar que almacén default corresponde a la sucursal y verificar cantidades/reservas reales",
        "Revalidar filas y lista autorizada vigente con este corte",
        "Ensayar lector, precio, cobro y devolución en staging con plan y reversión de existencias",
        "Auditar saldos y conservar tickets de prueba; ninguna venta productiva",
      ],
      rows: selected,
    },
    candidates,
    excluded,
  };
}

export async function prepareRenewedPilot(configPath, out) {
  const config = JSON.parse(await readFile(configPath)),
    base = dirname(resolve(configPath)),
    data = {},
    inputs = {};
  for (const name of [
    "previousRows",
    "currentRows",
    "previousWoo",
    "currentWoo",
    "snapshot",
    "phasePlan",
    "manifest",
  ]) {
    const pin = config.inputs?.[name];
    if (!pin || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? ""))
      throw Error("PINNED_INPUT_REQUIRED:" + name);
    const raw = await readFile(resolve(base, pin.path));
    if (sha(raw) !== pin.sha256) throw Error("INPUT_CHANGED:" + name);
    data[name] = JSON.parse(raw);
    inputs[name] = { sha256: pin.sha256 };
  }
  if (
    data.manifest.woo_sha256 !== inputs.currentWoo.sha256 ||
    data.manifest.sicar_sha256 !== config.sicar_sha256 ||
    data.currentWoo.scope !== "authenticated_csv_excludes_trash"
  )
    throw Error("SOURCE_MANIFEST_MISMATCH");
  const result = renewedPilot({
    ...data,
    limit: config.limit ?? 12,
    maxPerParent: config.maxPerParent ?? 3,
  });
  result.inputs = inputs;
  result.source_cut = {
    date: config.source_date,
    sicar_sha256: config.sicar_sha256,
    woo_sha256: inputs.currentWoo.sha256,
    woo_csv_sha256: data.currentWoo.source_csv_sha256,
  };
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Primer piloto con fuentes renovadas</title><style>body{font:17px system-ui;max-width:1100px;margin:32px auto;padding:18px;background:#f4f0e8;color:#192c34}section{background:white;border-radius:12px;padding:20px;margin:16px 0}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid #ddd}code{overflow-wrap:anywhere}</style><h1>Primer piloto con fuentes renovadas</h1><p>Corte recibido ${esc(config.source_date)}. Sólo preparación: no habilita ventas ni carga existencias.</p><section><h2>${result.summary.selected_codes} códigos de ${result.summary.selected_woo_parents} productos</h2><p>Elegidos dentro de la revisión anterior, con vínculo web estable, datos de catálogo iguales y evidencia positiva del almacén default. Las cantidades todavía deben confirmarse por sucursal; no se importaron.</p><table><tr><th>Código</th><th>Producto y variante</th><th>Precio público</th></tr>${result.pilot.rows.map((r) => `<tr><td><code>${esc(r.barcode)}</code></td><td>${esc(r.product_name)}<br>${esc(Object.values(r.attributes ?? {}).join(" · "))}</td><td>$${(r.public_price_cents / 100).toFixed(2)}</td></tr>`).join("")}</table></section><section><h2>Renovación completa</h2><p>${result.summary.source_codes} códigos SICAR. ${result.summary.catalogue_impacts} filas cargadas requieren revisión de datos nuevos. ${result.woo_comparison.summary.staged_codes_to_review} vínculos cargados relacionados con cambios web requieren revisar su fuente antes de actualizar. No se sustituyeron datos.</p><p>Los cambios de existencia se excluyen de la carga y no prueban por sí solos ventas. Los casos retenidos y las altas nuevas no entran automáticamente al piloto.</p></section><section><h2>Para ejecutar la prueba</h2><ol>${result.pilot.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol><p>La lista de venta de staging permanece sin activar por este preparador. Fotos y descripciones se leen de Woo como referencia; aquí no se asignan ni envían.</p></section></html>`;
  const files = {
    "piloto.json": json(result.pilot),
    "renovacion.json": json(result),
    "resumen.json": json(result.summary),
    "impacto-catalogo.json": json(result.catalogue_impacts),
    "cambios-sicar.json": json(result.source_delta),
    "cambios-woo.json": json(result.woo_comparison),
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
  console.log(await prepareRenewedPilot(...process.argv.slice(2)));
}
