import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ruleCohort,
  authorizeRule,
  digest,
  activityPlan,
} from "./acceleration.mjs";

const [configPath, out, authorizationPath] = process.argv.slice(2);
if (!out) throw Error("Usage: CONFIG.json NEW_OUTPUT [AUTHORIZATION.json]");
const config = JSON.parse(await readFile(configPath));
const data = {};
const sha = (b) => createHash("sha256").update(b).digest("hex");
for (const [key, pin] of Object.entries(config.inputs)) {
  const b = await readFile(pin.path);
  if (sha(b) !== pin.sha256) throw Error("INPUT_CHANGED:" + key);
  data[key] = JSON.parse(b);
}
for (const pin of config.engines)
  if (sha(await readFile(pin.path)) !== pin.sha256)
    throw Error("ENGINE_CHANGED:" + pin.path);
const cohort = ruleCohort({
  ...data,
  sourceSha: config.sicar_sha256,
  seed: config.seed,
});
const files = {
  "conjunto.json": cohort,
  "muestra.json": cohort.sample,
  "resumen.json": cohort.summary,
};
if (authorizationPath) {
  const a = JSON.parse(await readFile(authorizationPath));
  const authorized = authorizeRule(cohort, a.authorization, a.sampleReview);
  files["decision-regla.json"] = authorized.evidence;
  files["decisiones.json"] = authorized.decisions;
  files["lotes.json"] = authorized.batches;
}
const activity = activityPlan(
  data.rows.map((r) => ({
    barcode: r.barcode,
    inventoriable: r.fields["(s/n) inventariable"] === "s",
    open_woo_order: null,
  })),
  {},
  config.activity_scope,
);
files["actividad-sin-reportes.json"] = activity;
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const render = (c) =>
  `<article><h2>${esc(c.title)}</h2><table><tr><th>Código literal</th><th>Descripción SICAR</th><th>Talla</th><th>Precio1</th></tr>${c.members.map((m) => `<tr><td>${esc(m.barcode)}</td><td>${esc(m.description)}</td><td>${esc(m.proposed.suffix)}</td><td>$${(m.retail_cents / 100).toFixed(2)}</td></tr>`).join("")}</table></article>`;
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>M9 · Regla de tallas</title><style>body{font:16px system-ui;background:#f3f1eb;color:#172e27;margin:28px auto;max-width:1100px;padding:0 16px}article{background:white;padding:18px;margin:16px 0;border-radius:12px;overflow:auto}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}h2{overflow-wrap:anywhere}code{overflow-wrap:anywhere}</style><h1>Migración por regla de tallas</h1><p>${cohort.summary.eligible_families} familias · ${cohort.summary.eligible_rows} códigos elegibles · ${cohort.summary.excluded_families} familias fuera de la regla.</p><p>Muestra técnica reproducible de ${cohort.sample.length} familias. No representa respuestas de los dueños. Sólo staging, sin inventario ni publicación Woo. Archivar sigue pendiente de reportes completos.</p><p>Conjunto: <code>${cohort.cohort_sha256}</code></p>${cohort.sample.map(render).join("")}</html>\n`;
await mkdir(out);
const hashes = {};
for (const [name, value] of Object.entries({
  ...files,
  "reporte.html": html,
})) {
  const b =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
  await writeFile(resolve(out, name), b, { flag: "wx" });
  hashes[name] = sha(b);
}
await writeFile(
  resolve(out, "sha256.json"),
  JSON.stringify(hashes, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    ...cohort.summary,
    cohort_sha256: cohort.cohort_sha256,
    sample_sha256: digest(cohort.sample),
  }),
);
