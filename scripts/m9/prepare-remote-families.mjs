import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { reviewRemoteFamilies } from "./woo-remote/family-readiness.mjs";

// Offline only. No database client, HTTP transport or executable import output.
const [snapshotPath, reportPath, workbookPath, wooPath, outputPath] =
  process.argv.slice(2);
if (!outputPath || process.argv.length !== 7)
  throw new Error(
    "Uso: node scripts/m9/prepare-remote-families.mjs STAGING.json REPORTE SICAR.xlsx WOO.json SALIDA_NUEVA",
  );
const digest = (data) => createHash("sha256").update(data).digest("hex");
const read = (path) => readFile(resolve(path));
const checks = JSON.parse(await read(`${reportPath}/sha256.json`));
async function verified(name) {
  const bytes = await read(`${reportPath}/${name}`);
  if (digest(bytes) !== checks[name])
    throw new Error(`REPORT_HASH_CHANGED:${name}`);
  return JSON.parse(bytes);
}
const manifest = await verified("manifest.json");
const rows = await verified("filas.json");
if (
  digest(await read(workbookPath)) !== manifest.sicar_sha256 ||
  digest(await read(wooPath)) !== manifest.woo_sha256
)
  throw new Error("SOURCE_HASH_CHANGED");
const snapshotBytes = await read(snapshotPath);
const result = reviewRemoteFamilies(JSON.parse(snapshotBytes), rows);
result.sources = {
  snapshot_sha256: digest(snapshotBytes),
  sicar_sha256: manifest.sicar_sha256,
  woo_sha256: manifest.woo_sha256,
  report_rows_sha256: checks["filas.json"],
};
const out = resolve(outputPath);
await mkdir(out, { recursive: false });
const body = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(resolve(out, "familias.json"), body, { flag: "wx" });
const summary = [
  "# Preparación de familias para Woo de pruebas",
  "",
  `Productos revisados: ${result.summary.products}. Variantes en staging: ${result.summary.staged_variants}.`,
  `Estructura lista para ensayar el adaptador: ${result.summary.ready_for_adapter_test}. En revisión: ${result.summary.review_required}.`,
  `Productos con cambios frente al archivo SICAR recibido: ${result.summary.products_needing_refresh}.`,
  "",
  "Sólo lectura. No es una autorización ni un archivo de importación. El adaptador remoto de familias sigue pendiente.",
  "Los IDs Woo son referencias de origen; no se reutilizan como IDs de destino. No incluye existencias ni costos.",
  "",
  ...result.families.flatMap((f) => [
    `## ${f.name.replaceAll("\n", " ")}`,
    "",
    `${f.staged_variants} variantes · ${f.photos} fotos · ${f.state}`,
    `Revisión: ${f.reasons.join(", ") || "estructura completa para el siguiente ensayo"}.`,
    `Filas SICAR fuera del piloto: ${f.sicar_rows_outside_pilot.length}; variantes web fuera del piloto: ${f.woo_variations_outside_pilot.length}.`,
    ...f.changes.map(
      (c) =>
        `- Código ${c.barcode}: ${c.field}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`,
    ),
    "",
  ]),
].join("\n");
await writeFile(resolve(out, "resumen.md"), summary, { flag: "wx" });
await writeFile(
  resolve(out, "sha256.json"),
  `${JSON.stringify({ "familias.json": digest(body), "resumen.md": digest(summary) }, null, 2)}\n`,
  { flag: "wx" },
);
console.log(JSON.stringify(result.summary));
