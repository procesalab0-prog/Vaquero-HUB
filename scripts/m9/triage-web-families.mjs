import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "./prepare-web-content.mjs";
import { verifiedFile } from "./review-web-families.mjs";

const stockChecks = new Set([
  "EXISTENCIA_DIFIERE; capturas y alcance pueden diferir",
  "EXISTENCIA_WOO_NO_DISPONIBLE",
]);
export function triageFamilies(report) {
  if (
    report.version !== "m9-web-family-review-1" ||
    report.woo_writes_enabled !== false
  )
    throw new Error("INVALID_REVIEW");
  const members = [],
    candidates = [];
  for (const f of report.families) {
    for (const v of f.woo_members) {
      if (v.state === "EXACT_CANONICAL_LINK") continue;
      const row = v.sicar.length === 1 ? v.sicar[0] : null;
      const checks = row?.commercial_checks ?? [];
      const onlyStock =
        row &&
        v.status === "publish" &&
        !row.issues?.length &&
        checks.length > 0 &&
        checks.every((c) => stockChecks.has(c)) &&
        ["CONFLICT", "MATCH_EXACT_VARIANT"].includes(row.classification) &&
        row.product_id === f.woo_product_id &&
        row.variation_id === v.woo_id;
      const bucket = onlyStock
        ? "STOCK_OBSERVATION_ONLY_NO_APPROVAL"
        : row &&
            checks.some((c) => c.startsWith("PRECIO_WOO_DISTINTO_PUBLICO;"))
          ? "PRICE_REVIEW"
          : v.state === "NO_CONFIRMED_SICAR_LINK"
            ? "NO_CONFIRMED_SICAR_LINK"
            : "OTHER_MANUAL_REVIEW";
      members.push({
        woo_product_id: f.woo_product_id,
        name: f.name,
        bucket,
        ...v,
        send_allowed: false,
      });
    }
    for (const row of f.sicar_candidate_rows) {
      const reasons = row.reasons ?? [];
      const bucket =
        row.classification === "SPECIAL_SUFFIX" &&
        reasons.includes(
          "MUESTRA_SOLO_EXHIBICION; no crear variante vendible automaticamente",
        )
          ? "DISPLAY_ONLY_EXISTING_RULE"
          : reasons.includes("PREFIJOS_SUPERPUESTOS; no se elige el mas largo")
            ? "OVERLAPPING_BASES_REVIEW"
            : row.issues?.includes("EXISTENCIA_INVALIDA")
              ? "INVALID_STOCK_UNMATCHED_IDENTITY"
              : "ATTRIBUTE_REVIEW";
      candidates.push({
        woo_product_id: f.woo_product_id,
        name: f.name,
        bucket,
        sicar: row,
        send_allowed: false,
      });
    }
  }
  const counts = {};
  for (const item of [...members, ...candidates])
    counts[item.bucket] = (counts[item.bucket] ?? 0) + 1;
  return {
    version: "m9-web-family-triage-1",
    purpose: "DIAGNOSTIC_ONLY_NOT_APPROVAL",
    canonical_classifications_changed: false,
    woo_writes_enabled: false,
    inventory_included: false,
    members,
    candidates,
    counts,
  };
}
const clean = (v) => String(v ?? "").replace(/[|\r\n<>[\]!*_`]/g, " ");
const attributes = (v) =>
  v.attributes.map((a) => `${a.name}: ${a.option}`).join(", ");
async function main() {
  const [reviewDir, wooPath, decisionsPath, out] = process.argv.slice(2);
  if (process.argv.length !== 6)
    throw new Error("Usage: REVIEW_DIR WOO_JSON DECISIONS_JSON NEW_OUT");
  const review = await verifiedFile(reviewDir, "familias.json");
  const wooRaw = await readFile(wooPath),
    decisionsRaw = await readFile(decisionsPath);
  if (sha256(wooRaw) !== review.data.sources.woo_sha256)
    throw new Error("WOO_SOURCE_MISMATCH");
  const woo = JSON.parse(wooRaw);
  JSON.parse(decisionsRaw);
  const result = triageFamilies(review.data);
  result.sources = {
    families_sha256: sha256(review.raw),
    woo_sha256: sha256(wooRaw),
    decisions_sha256: sha256(decisionsRaw),
  };
  const publicInfo = new Map(
    woo.products.map((p) => [
      p.id,
      { id: p.id, name: p.name, base: p.short_description, status: p.status },
    ]),
  );
  for (const candidate of result.candidates)
    candidate.parent_evidence = (
      candidate.sicar.candidate_product_ids ?? []
    ).map((id) => {
      if (!publicInfo.has(id)) throw new Error("CANDIDATE_PARENT_NOT_FOUND");
      return publicInfo.get(id);
    });
  const lines = [
    "# Pendientes del piloto por causa",
    "",
    "Diagnóstico local, sin aprobación ni cambios de catálogo. Las clasificaciones originales y los códigos SICAR permanecen intactos.",
    "",
    "## Existencias: revisar en su fase, sin importar ahora",
    "",
    `Hay ${result.counts.STOCK_OBSERVATION_ONLY_NO_APPROVAL ?? 0} miembros con vínculo identificado cuya observación comercial sólo afecta existencias. No se reclasifican ni se habilitan para importar. La diferencia puede depender de la fecha o alcance de cada captura.`,
    "",
    "## Precio",
    "",
  ];
  for (const v of result.members.filter((v) => v.bucket === "PRICE_REVIEW")) {
    const r = v.sicar[0];
    lines.push(
      `- ${clean(v.name)}, ${clean(attributes(v))}. Código SICAR ${clean(r.barcode)}: público $${clean(r.retail_sicar)}; Woo regular $${clean(v.regular_price_woo)}; rebajado ${clean(v.sale_price_woo) || "no capturado"}. Inicio/fin de promoción: ${clean(v.promotion_start) || "vacío"} / ${clean(v.promotion_end) || "vacío"}.`,
      "  Pregunta: ¿la diferencia corresponde a una promoción intencional o a un precio web que falta actualizar? Precio1 ya está confirmado como precio público; no se vuelve a preguntar esa regla.",
    );
  }
  lines.push("", "## Identidad y tallas por confirmar", "");
  const grouped = new Map();
  for (const c of result.candidates.filter((c) =>
    ["OVERLAPPING_BASES_REVIEW", "ATTRIBUTE_REVIEW"].includes(c.bucket),
  )) {
    const key = `${c.woo_product_id}:${c.bucket}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(c);
  }
  for (const group of grouped.values()) {
    const c = group[0];
    lines.push(
      `### ${clean(c.name)}`,
      "",
      ...c.parent_evidence.map(
        (p) =>
          `- Woo ${p.id}: ${clean(p.name)}; base ${clean(p.base)}; estado ${p.status}.`,
      ),
      "",
      ...group.map(
        (x) =>
          `- SICAR ${clean(x.sicar.barcode)}: ${clean(x.sicar.description)}.`,
      ),
    );
    if (c.bucket === "OVERLAPPING_BASES_REVIEW" && c.woo_product_id === 23966)
      lines.push(
        "",
        "Pregunta: ¿estos códigos corresponden al sombrero bicolor y deben vincularse a ese modelo, manteniendo separado el natural? La semejanza del prefijo no aprueba la relación.",
      );
    else if (c.woo_product_id === 27074)
      lines.push(
        "",
        "Pregunta: para esta camisa, ¿la talla XXL de SICAR es exactamente la misma variante que 2XL en Woo? La posible equivalencia debe aprobarse para este modelo; no se aplicará globalmente.",
      );
    else
      lines.push(
        "",
        "Pregunta: ¿cuál es el modelo y la variante que corresponde a cada código SICAR de esta lista?",
      );
    lines.push("");
  }
  lines.push(
    "## Muestras de exhibición",
    "",
    `${result.counts.DISPLAY_ONLY_EXISTING_RULE ?? 0} códigos ya tienen la regla de muestra sólo exhibición. Se conservan y no se convierten en variantes vendibles. No hace falta volver a preguntar esa regla.`,
    "",
    ...result.candidates
      .filter((c) => c.bucket === "DISPLAY_ONLY_EXISTING_RULE")
      .map(
        (c) => `- ${clean(c.sicar.barcode)} — ${clean(c.sicar.description)}.`,
      ),
    "",
    "## Dato de existencia inválido con identidad aún pendiente",
    "",
    ...result.candidates
      .filter((c) => c.bucket === "INVALID_STOCK_UNMATCHED_IDENTITY")
      .map(
        (c) =>
          `- ${clean(c.sicar.barcode)} — ${clean(c.sicar.description)}. Corregir la fuente en su fase; el parecido con una variante Woo no confirma identidad.`,
      ),
    "",
    "## Variantes Woo sin vínculo confirmado",
    "",
    "Esta lista no significa que el producto físico no exista en SICAR. Sólo indica que el conciliador no ha probado su relación. Conservar en Woo; no inventar códigos, importar ni borrar. Para cerrar cada caso hace falta el código SICAR exacto o una decisión documentada de conservarlo sin vínculo. Los casos de talla o dato inválido arriba pueden solaparse con esta lista.",
    "",
    "| Familia | Woo variante | Atributos |",
    "| --- | ---: | --- |",
    ...result.members
      .filter((v) => v.bucket === "NO_CONFIRMED_SICAR_LINK")
      .map(
        (v) => `| ${clean(v.name)} | ${v.woo_id} | ${clean(attributes(v))} |`,
      ),
    "",
    "## Trazabilidad",
    "",
    `Reporte fuente SHA-256: ${result.sources.families_sha256}`,
    "",
    "Los detalles de las observaciones de existencias y todos los motivos originales están en pendientes.json. Este paquete no contiene un importador, aprobación ni instrucciones de escritura.",
  );
  await mkdir(out);
  const files = {
    "pendientes.json": JSON.stringify(result, null, 2) + "\n",
    "revision.md": lines.join("\n") + "\n",
  };
  for (const [name, raw] of Object.entries(files))
    await writeFile(resolve(out, name), raw, { flag: "wx" });
  await writeFile(
    resolve(out, "sha256.json"),
    JSON.stringify(
      Object.fromEntries(Object.entries(files).map(([n, r]) => [n, sha256(r)])),
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(result.counts));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
