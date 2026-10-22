import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { planCatalogPhotoRefresh } from "./catalogo-fotos-refresh.mjs";
const sha = (x) => createHash("sha256").update(x).digest("hex");
const json = (x) => JSON.stringify(x, null, 2) + "\n";
const escape = (x) =>
  String(x).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export async function runCatalogPhotoReport(configPath, outPath) {
  const config = JSON.parse(await readFile(configPath, "utf8")),
    inputs = {},
    inputHashes = {};
  for (const name of [
    "coverage",
    "gaps",
    "bindings",
    "contexts",
    "before",
    "after",
    "metadata",
    "woo",
  ]) {
    const source = config.inputs?.[name];
    if (!source || !/^[a-f0-9]{64}$/.test(source.sha256))
      throw Error("PINNED_INPUT_REQUIRED");
    const path = resolve(dirname(configPath), source.path),
      bytes = await readFile(path);
    if (sha(bytes) !== source.sha256) throw Error(`INPUT_SHA_CHANGED:${name}`);
    inputs[name] = JSON.parse(bytes);
    inputHashes[name] = source.sha256;
  }
  const coverage = inputs.coverage[0].coverage,
    metadata = inputs.metadata[0];
  if (
    metadata.nonempty_evidence !== metadata.copied ||
    metadata.copied !== metadata.exact_metadata_and_reader ||
    metadata.object_problems !== 0 ||
    metadata.mapping_problems !== 0 ||
    metadata.identity_problems !== 0
  )
    throw Error("EXISTING_PHOTO_COPY_REVIEW_REQUIRED");
  const plan = planCatalogPhotoRefresh({
    project_id: config.project_id,
    coverage,
    gaps: inputs.gaps,
    bindings: inputs.bindings,
    contexts: inputs.contexts,
    before: inputs.before,
    after: inputs.after,
    woo: inputs.woo,
  });
  const summary = {
    ...plan.summary,
    verified_metadata_copies: metadata.exact_metadata_and_reader,
    registered_absences:
      inputs.before.evidence.rows - inputs.before.copies.rows,
    observed_at: config.observed_at,
    woo_export_date: config.woo_export_date,
    snapshot_scope: `ALL_MANAGED_VARIANTS_AGGREGATED_AND_ALL_${plan.summary.gap_variants}_PHOTO_GAPS_EXPORTED`,
    all_twelve_audits_unchanged: true,
    ...{ import_allowed: false, send_allowed: false, writes_performed: 0 },
  };
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M9 fotos: siguiente lote protegido</title><style>body{font:18px/1.6 system-ui;max-width:1000px;padding:24px;margin:auto;background:#f5f2e9;color:#172d36}section{padding:24px;background:white;border-radius:14px;margin:20px 0}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}code{overflow-wrap:anywhere}</style><h1>Fotos del catálogo: revisión y siguiente lote</h1><p>Lectura de staging del ${escape(config.observed_at)}. Comparación con Woo exportado el ${escape(config.woo_export_date)}. Sin escrituras, descargas o publicación Woo.</p><section><h2>Lo que ya está conservado</h2><p>${summary.catalog_variants} códigos SICAR: ${summary.linked_woo_variants} vinculados a Woo y ${summary.sicar_only} sólo SICAR. ${summary.registered_copies} copias de variantes mantienen vínculo, URL, orden, alt y metadatos del objeto correctos. ${summary.registered_absences} ausencias registradas permanecen vacías. Esto no afirma una nueva comprobación de bytes ni un porcentaje global de migración.</p></section><section><h2>Siguiente preparación técnica: ${summary.new_photos_to_prepare} códigos en ${summary.families_to_prepare} familias</h2><p>Woo añadió fotos donde la evidencia guardada de la variante estaba vacía. Los IDs, atributos y códigos tienen correspondencia exacta con el catálogo actual. La galería del producto no se reemplaza. Antes de aplicar deben verificarse los bytes y ensayarse una renovación condicionada de fuentes que conserve ${summary.existing_evidence_to_revalidate} evidencias anteriores.</p><p><strong>Lote de importación autorizado por este reporte: cero.</strong> El archivo lote-inerte.json sólo prepara la revisión; no es payload ejecutable ni autorización.</p><table><thead><tr><th>Familia</th><th>Fotos nuevas</th><th>Evidencias que conservar</th></tr></thead><tbody>${plan.families.map((f) => `<tr><td>${escape(f.name)}</td><td>${f.new_variant_photos}</td><td>${f.existing_evidence_to_revalidate}</td></tr>`).join("")}</tbody></table></section><section><h2>Resto de las variantes sin evidencia propia</h2><ul>${Object.entries(
    summary.states,
  )
    .map(([k, v]) => `<li>${escape(k)}: ${v}</li>`)
    .join(
      "",
    )}</ul><p>Las cinco variantes del padre Woo33002 borrador siguen retenidas. Los enlaces ausentes se investigan técnicamente; no se inventan equivalencias ni imágenes de talla. Las ausencias no se convierten en existencias cero. No se añadieron preguntas a los dueños.</p></section><section><h2>Conservación</h2><p>Doce huellas antes/después coinciden: catálogo, códigos, fuentes, borradores, evidencia, copias, objetos e inventario. No se cambia precio, costo, stock, historial, galería manual, fuente ni datos de clientes. Una fuente renovada cambia su huella: no actualizar sin revalidar las evidencias previas en la misma transacción.</p><p>Plan SHA256: <code>${plan.plan_sha256}</code></p></section></html>`;
  // One immutable directory per run. Never reuse a historical report location.
  await mkdir(outPath, { recursive: false, mode: 0o700 });
  const files = {
    "summary.json": json(summary),
    "plan.json": json(plan),
    "lote-inerte.json": json(plan.inert_batch),
    "familias.json": json(plan.families),
    "input-sha256.json": json(inputHashes),
    "reporte.html": html,
  };
  for (const [name, content] of Object.entries(files))
    await writeFile(resolve(outPath, name), content, {
      mode: 0o600,
      flag: "wx",
    });
  const manifest = Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, sha(content)]),
  );
  await writeFile(resolve(outPath, "manifest.json"), json(manifest), {
    mode: 0o600,
    flag: "wx",
  });
  return summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4)
    throw Error("USAGE: node catalogo-fotos-reporte.mjs CONFIG OUTPUT");
  console.log(
    json(
      await runCatalogPhotoReport(
        resolve(process.argv[2]),
        resolve(process.argv[3]),
      ),
    ),
  );
}
