import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const [reportDir, coveragePath, out] = process.argv.slice(2);
if (!out) throw Error("Usage: REPORT_DIR COVERAGE.json NEW_OUTPUT");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const bytes = await readFile(resolve(reportDir, "filas.json"));
const checks = JSON.parse(await readFile(resolve(reportDir, "sha256.json")));
if (hash(bytes) !== checks["filas.json"]) throw Error("REPORT_CHANGED");
const source = JSON.parse(bytes),
  coverageBytes = await readFile(coveragePath),
  coverage = JSON.parse(coverageBytes);
const states = new Map(coverage.items.map((x) => [x.barcode, x]));
if (
  states.size !== coverage.items.length ||
  source.length !== coverage.items.length ||
  source.some(
    (r) =>
      !states.has(r.barcode) ||
      states.get(r.barcode).description !== r.description,
  )
)
  throw Error("COVERAGE_MISMATCH");
const rows = source
  .filter((r) => states.get(r.barcode).state !== "IN_STAGING")
  .map((r) => {
    const questions = [];
    const f = r.fields;
    if (
      ["departamento", "categoria"].some(
        (k) => !f[k] || /^(D1|C1|\.|SIN DEFINIR)$/i.test(f[k]),
      )
    )
      questions.push("CLASIFICACION");
    if (!/^\d+(\.\d{1,2})?$/.test(f.precio1) || Number(f.precio1) <= 0)
      questions.push("PRECIO_PUBLICO");
    if (r.reasons.some((x) => x.includes("DESCRIPCION_SICAR_DUPLICADA")))
      questions.push("IDENTIDAD_REPETIDA");
    const task =
      r.classification === "SICAR_ONLY"
        ? "REVISAR_FAMILIA_SICAR"
        : r.classification === "DUPLICATE_WOO_BASE"
          ? "REVISAR_PADRES_WOO"
          : r.display_only
            ? "CONSERVAR_SOLO_EXHIBICION"
            : "REVISAR_EVIDENCIA_TECNICA";
    return {
      barcode: r.barcode,
      description: r.description,
      department: f.departamento,
      section: f.categoria,
      public_price: f.precio1,
      classification: r.classification,
      questions,
      task,
      reasons: r.reasons,
      commercial_checks: r.commercial_checks,
      woo_candidates: r.candidate_product_ids ?? [],
      import_allowed: false,
    };
  })
  .sort((a, b) => (a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0));
const summary = {
  source_rows: source.length,
  in_staging: source.length - rows.length,
  pending: rows.length,
  questions: Object.fromEntries(
    ["CLASIFICACION", "PRECIO_PUBLICO", "IDENTIDAD_REPETIDA"].map((k) => [
      k,
      rows.filter((r) => r.questions.includes(k)).length,
    ]),
  ),
  tasks: Object.fromEntries(
    [...new Set(rows.map((r) => r.task))]
      .sort()
      .map((k) => [k, rows.filter((r) => r.task === k).length]),
  ),
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const table = (rs) =>
  "<table><tr><th>Código</th><th>Descripción SICAR</th><th>Departamento / sección</th><th>Precio público</th></tr>" +
  rs
    .map(
      (r) =>
        `<tr><td>${esc(r.barcode)}</td><td>${esc(r.description)}</td><td>${esc(r.department)} / ${esc(r.section)}</td><td>${esc(r.public_price)}</td></tr>`,
    )
    .join("") +
  "</table>";
const sections = [
  [
    "CLASIFICACION",
    "¿Qué departamento y sección deben llevar estos productos?",
  ],
  [
    "PRECIO_PUBLICO",
    "¿Cuál es el precio público correcto? El archivo lo trae vacío, inválido o en cero.",
  ],
  [
    "IDENTIDAD_REPETIDA",
    "¿Son variantes distintas o registros repetidos? Indiquen qué distingue cada código.",
  ],
];
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dudas consolidadas M9</title><style>body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:16px}td,th{padding:8px;border-bottom:1px solid #ccc;text-align:left}table{width:100%;border-collapse:collapse}summary{cursor:pointer;padding:16px;background:#eee}details{margin:16px 0}</style><h1>Dudas para revisar juntas</h1><p>Datos del corte SICAR6 y Woo histórico. ${summary.pending} registros pendientes; no equivale a ${summary.pending} preguntas. Ninguna respuesta se aplica automáticamente.</p><h2>1. Camisa Wrangler de niño CAWRNIÑO3587</h2><p>¿Es un solo modelo con S (4485), M (4403), L (4484), XL (4402), todas a $740? Ya consultado: pendiente de respuesta.</p>${sections.map(([k, title], i) => `<h2>${i + 2}. ${title}</h2><details><summary>Ver ${summary.questions[k]} registros</summary>${table(rows.filter((r) => r.questions.includes(k)))}</details>`).join("")}<h2>Revisión interna</h2><p>Las diferencias de existencias entre capturas se revisan técnicamente y no autorizan copiar inventario. Los vínculos Woo y las familias sin confirmar siguen pendientes: se preparará evidencia por caso antes de solicitar decisiones. No se vuelven a preguntar las políticas ya acordadas sobre códigos, costo desconocido, precio1, muestras o amartigones.</p></html>`;
const files = {
  "pendientes.json":
    JSON.stringify(
      {
        version: "m9-pending-review-1",
        sources: {
          rows_sha256: hash(bytes),
          coverage_sha256: hash(coverageBytes),
        },
        summary,
        rows,
      },
      null,
      2,
    ) + "\n",
  "dudas.html": html,
  "resumen.json": JSON.stringify(summary, null, 2) + "\n",
};
await mkdir(out);
for (const [name, content] of Object.entries(files))
  await writeFile(resolve(out, name), content, { flag: "wx" });
await writeFile(
  resolve(out, "sha256.json"),
  JSON.stringify(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, hash(v)])),
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(summary);
