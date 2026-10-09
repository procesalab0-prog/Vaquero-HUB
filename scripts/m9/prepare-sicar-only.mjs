import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const json = (x) => JSON.stringify(x, null, 2) + "\n";
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function price(s) {
  if (typeof s !== "string" || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [a, b = ""] = s.split(".");
  const n = BigInt(a) * 100n + BigInt(b.padEnd(2, "0"));
  return n > 0n && n <= 100000000n ? Number(n) : null;
}
export function prepareSicarOnly(rows) {
  const counts = new Map();
  for (const r of rows) counts.set(r.barcode, (counts.get(r.barcode) ?? 0) + 1);
  const records = rows
    .filter((r) => r.classification === "SICAR_ONLY")
    .map((r) => {
      const f = r.fields;
      if (
        !f ||
        typeof r.barcode !== "string" ||
        r.barcode !== f["clave1 *"] ||
        r.description !== f["descripción *"]
      )
        throw Error("SOURCE_IDENTITY_CHANGED");
      const issues = [...(r.issues ?? []), ...(r.commercial_checks ?? [])];
      if (
        !r.barcode ||
        r.barcode.trim() !== r.barcode ||
        counts.get(r.barcode) !== 1
      )
        issues.push("BARCODE_REVIEW");
      if (
        r.product_id != null ||
        r.variation_id != null ||
        (r.candidate_product_ids ?? []).length
      )
        issues.push("WOO_CANDIDATE_REVIEW");
      for (const k of ["departamento", "categoria"])
        if (
          !f[k] ||
          /^(D1|C1|\.|SIN DEFINIR)$/i.test(f[k]) ||
          f[k].trim() !== f[k]
        )
          issues.push("TAXONOMY_REVIEW");
      const retail = price(f.precio1);
      if (retail === null) issues.push("RETAIL_PRICE_REVIEW");
      if (r.display_only || /MUESTRA/i.test(r.description))
        issues.push("DISPLAY_ONLY_REVIEW");
      if (f["(s/n) mostrar en ventas"] !== "s")
        issues.push("SALES_VISIBILITY_REVIEW");
      const evidence = {
        barcode: r.barcode,
        description: r.description,
        department: f.departamento,
        section: f.categoria,
        retail_source: f.precio1,
        sales_visibility: f["(s/n) mostrar en ventas"],
      };
      // Only a literal T. delimiter yields a proposal. Numeric tails are not split.
      const explicit =
        /^(.+)T\.(XS|S|M|L|XL|XXL|XXXL|\d+(?:\.\d+)?(?:X\d+(?:\.\d+)?)?)$/.exec(
          r.description,
        );
      const proposed = explicit
        ? { base: explicit[1], suffix: explicit[2] }
        : null;
      return {
        ...evidence,
        retail_cents: retail,
        cost_cents: null,
        wholesale_cents: null,
        medium_wholesale_cents: null,
        evidence_sha256: hash(json(evidence)),
        issues: [...new Set(issues)].sort(),
        proposed,
        status: "MANUAL_IDENTITY_REVIEW",
        import_allowed: false,
      };
    })
    .sort(
      (a, b) =>
        order(a.barcode, b.barcode) || order(a.description, b.description),
    );
  const groups = new Map();
  for (const r of records)
    if (r.proposed) {
      const key = json([r.department, r.section, r.proposed.base]);
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
  const families = [...groups.entries()]
    .map(([key, members]) => ({
      id: hash(key),
      base: members[0].proposed.base,
      department: members[0].department,
      section: members[0].section,
      codes: members.map((r) => r.barcode),
      suffixes: members.map((r) => r.proposed.suffix),
      evidence_sha256: hash(json(members.map((r) => r.evidence_sha256))),
      issues: [
        ...new Set([
          ...members.flatMap((r) => r.issues),
          ...(new Set(members.map((r) => r.proposed.suffix)).size !==
          members.length
            ? ["REPEATED_SUFFIX"]
            : []),
        ]),
      ].sort(),
      status: "PROPOSAL_NOT_APPROVED",
      import_allowed: false,
    }))
    .sort((a, b) => order(a.id, b.id));
  return {
    version: "m9-sicar-only-review-1",
    inventory_included: false,
    woo_writes: false,
    summary: {
      rows: records.length,
      explicit_delimiter_rows: records.filter((r) => r.proposed).length,
      without_delimiter_rows: records.filter((r) => !r.proposed).length,
      rows_with_data_issues: records.filter((r) => r.issues.length).length,
      proposed_families: families.length,
      approved_for_import: 0,
    },
    records,
    families,
  };
}
async function main() {
  const [reportDir, workbookPath, wooPath, output] = process.argv.slice(2);
  if (!output) throw Error("Usage: REPORT SICAR.xlsx WOO.json NEW_OUTPUT");
  const checks = JSON.parse(await readFile(resolve(reportDir, "sha256.json")));
  async function verified(name) {
    const b = await readFile(resolve(reportDir, name));
    if (hash(b) !== checks[name]) throw Error("REPORT_HASH_CHANGED");
    return JSON.parse(b);
  }
  const manifest = await verified("manifest.json"),
    rows = await verified("filas.json");
  if (
    hash(await readFile(workbookPath)) !== manifest.sicar_sha256 ||
    hash(await readFile(wooPath)) !== manifest.woo_sha256
  )
    throw Error("SOURCE_HASH_CHANGED");
  const review = prepareSicarOnly(rows);
  review.sources = {
    sicar_sha256: manifest.sicar_sha256,
    woo_sha256: manifest.woo_sha256,
    rows_sha256: checks["filas.json"],
  };
  const files = {
    "revision.json": json(review),
    "resumen.txt": `SICAR sin correspondencia Woo en esta captura\n${JSON.stringify(review.summary, null, 2)}\nTodos los códigos se conservan. Las propuestas con T. requieren revisión; los números finales no se cortan automáticamente. Ninguna fila autoriza alta ni publicación. Costos y mayoreos siguen sin definir. Sin existencias.\n`,
  };
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  files["revision.html"] =
    `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SICAR sin Woo — revisión</title><style>body{font:16px system-ui;max-width:1200px;margin:32px auto;padding:0 20px;background:#f5f5f2;color:#202522}input{padding:14px;width:90%;font:inherit}table{border-collapse:collapse;width:100%;background:white}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}header{position:sticky;top:0;background:#f5f5f2;padding:12px}small{color:#566}td:first-child{font-weight:bold}</style><header><h1>Productos SICAR sin coincidencia en Woo</h1><p>${review.summary.rows} registros incluidos en la migración · Revisión previa a la carga</p><p>Conservamos el código original. No se han creado productos ni importado existencias.</p><input id="q" placeholder="Buscar código, descripción, departamento o sección" aria-label="Buscar"><p id="count"></p></header><table><thead><tr><th>Código SICAR</th><th>Descripción original</th><th>Departamento / sección</th><th>Precio público</th><th>Por revisar</th></tr></thead><tbody>${review.records.map((r) => `<tr><td>${esc(r.barcode)}</td><td>${esc(r.description)}</td><td>${esc(r.department)}<br><small>${esc(r.section)}</small></td><td>${r.retail_cents === null ? "Revisar" : "$" + (r.retail_cents / 100).toFixed(2)}</td><td>${esc(r.issues.join(", ") || (r.proposed ? "Confirmar familia y talla T." : "Confirmar modelo; no deducir talla"))}</td></tr>`).join("")}</tbody></table><script>const rows=[...document.querySelectorAll('tbody tr')],q=document.getElementById('q'),count=document.getElementById('count');function filter(){let n=0;for(const row of rows){const show=row.textContent.toLowerCase().includes(q.value.toLowerCase());row.hidden=!show;if(show)n++;}count.textContent=n+' registros';}q.addEventListener('input',filter);filter();</script></html>`;
  await mkdir(output);
  for (const [name, content] of Object.entries(files))
    await writeFile(resolve(output, name), content, { flag: "wx" });
  await writeFile(
    resolve(output, "sha256.json"),
    json(
      Object.fromEntries(Object.entries(files).map(([k, v]) => [k, hash(v)])),
    ),
    { flag: "wx" },
  );
  console.log(review.summary);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
