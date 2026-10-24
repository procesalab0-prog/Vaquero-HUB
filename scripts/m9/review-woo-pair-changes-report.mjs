import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { reviewWooPairChanges } from "./review-woo-pair-changes.mjs";
import {
  decodeCoverageAudit,
  decodeCoveragePage,
  assembleCatalogCoverage,
} from "./catalogo-cobertura-pages.mjs";
const sha = (v) => createHash("sha256").update(v).digest("hex");
const must = (v, m) => {
  if (!v) throw Error(m);
};
export async function prepareWooPairReview(configPath, out) {
  const cfg = JSON.parse(readFileSync(configPath)),
    base = dirname(configPath),
    pins = [];
  must(
    cfg.protocol === "m9-woo19-23-pair-review-config-1" &&
      cfg.mode === "OFFLINE_NO_ASSIGNMENT" &&
      cfg.expected_codes.length === 19,
    "PINNED_PAIR_CONFIG_REQUIRED",
  );
  const load = (name, p, json = true) => {
    must(p && /^[a-f0-9]{64}$/.test(p.sha256 ?? ""), "PIN_REQUIRED:" + name);
    const path = resolve(base, p.path),
      b = readFileSync(path);
    must(sha(b) === p.sha256, "INPUT_CHANGED:" + name);
    pins.push({ name, path, sha256: sha(b) });
    return json ? JSON.parse(b) : path;
  };
  const input = {};
  for (const name of [
    "before",
    "after",
    "woo_before",
    "woo_after",
    "coverage_config",
  ])
    input[name] = load(name, cfg.inputs[name]);
  const readerPath = load("reader", cfg.inputs.reader, false),
    rulesPath = load("rules", cfg.inputs.rules, false);
  must(
    rulesPath === resolve(dirname(readerPath), "../../lib/m9-reconcile.ts"),
    "RULES_MODULE_MUST_MATCH_EXISTING_READER",
  );
  const { readWoo } = await import(pathToFileURL(readerPath));
  const coverageBase = dirname(resolve(base, cfg.inputs.coverage_config.path)),
    covered = (name, p) =>
      load(name, { ...p, path: resolve(coverageBase, p.path) });
  const c = input.coverage_config;
  must(
    c.project_id === "zsezjtswqeijboezvado" && c.pages.length === 32,
    "COMPLETE_NATIVE_COVERAGE_REQUIRED",
  );
  const beforeAudit = decodeCoverageAudit(
      covered("before_audit", c.inputs.before_audit),
    ),
    afterAudit = decodeCoverageAudit(
      covered("after_audit", c.inputs.after_audit),
    );
  const snapshot = assembleCatalogCoverage(
    c.pages.map((p, i) => decodeCoveragePage(covered("page_" + i, p))),
    beforeAudit,
    afterAudit,
  );
  must(
    snapshot.rows.length === 15961 && beforeAudit.length === 179,
    "ACTUAL_SNAPSHOT_SCOPE_REQUIRED",
  );
  const result = reviewWooPairChanges({
    before: input.before,
    after: input.after,
    wooBefore: readWoo(input.woo_before),
    wooAfter: readWoo(input.woo_after),
    snapshot,
    expectedCodes: cfg.expected_codes,
  });
  const questions = [];
  for (const group of result.groups) {
    const example = result.rows.find((r) => group.codes.includes(r.barcode));
    if (group.cause === "BASE_REUSED_OR_CHANGED_KEEP_HISTORY")
      questions.push({
        topic: "CAMISA_BASE_CAMBIADA",
        codes: group.codes,
        question:
          "En la camisa Maja, ¿azul marino y azul obscuro son modelos distintos o corrigieron el nombre y el código del mismo modelo?",
        examples: [
          "Camisa Maja azul marino, talla L",
          "Camisa Maja azul obscuro, talla L",
        ],
        options: [
          {
            value: "DISTINCT_MODELS",
            label: "Son modelos distintos; conservar sus códigos",
          },
          {
            value: "SAME_MODEL_WOO_CORRECTION",
            label: "Es el mismo modelo; se corrigió Woo",
          },
          {
            value: "REVIEW_IN_STORE",
            label: "No estoy seguro; revisar con una prenda",
          },
        ],
        selected_option: null,
        evidence: {
          woo_parent_id: example.Woo_source.after.product_id,
          base_before: example.Woo_source.before.base_from_existing_reader,
          base_after: example.Woo_source.after.base_from_existing_reader,
          occupied_targets: result.rows
            .filter(
              (r) =>
                group.codes.includes(r.barcode) && r.target_occupants.length,
            )
            .map((r) => ({
              barcode: r.barcode,
              proposed_pair: r.reconciled_pair_after,
              already_bound_codes: r.target_occupants.map((x) => x.barcode),
            })),
        },
        answer_scope:
          "Confirmar producto físico y conservar código de cada prenda; no autoriza transferir automáticamente historial o stock.",
      });
    if (group.cause === "EXACT_ATTRIBUTE_TEXT_CHANGED_KEEP_HISTORY")
      questions.push({
        topic: "COLOR_CON_ACENTO",
        codes: group.codes,
        question:
          "En la soga de plástico, ¿el cambio de color Cafe a CAFÉ sólo corrige la escritura y corresponde a la misma variante?",
        examples: ["Soga de plástico color café"],
        options: [
          {
            value: "SAME_VARIANT_SPELLING",
            label: "Es la misma variante; sólo cambió la escritura",
          },
          {
            value: "DISTINCT_VARIANT",
            label: "Son colores o productos distintos",
          },
          { value: "REVIEW_IN_STORE", label: "No sé; revisar en tienda" },
        ],
        selected_option: null,
        evidence: {
          barcode: example.barcode,
          description_code: example.sicar_description,
          woo_parent_id: example.Woo_source.after.product_id,
          variation_id: example.Woo_source.after.variation.id,
          attributes_before: example.Woo_source.before.variation.attributes,
          attributes_after: example.Woo_source.after.variation.attributes,
        },
        answer_scope:
          "La equivalencia con acento necesita confirmación explícita; conservar el vínculo anterior entretanto.",
      });
  }
  const summary = {
    ...result.summary,
    owner_topics: questions.length,
    source_SICAR_business_date: "2026-10-22",
    source_Woo_before_business_date: "2026-10-19",
    source_Woo_after_business_date: "2026-10-23",
    staging_is_pre_export: true,
    write_allowed: false,
    assignment_allowed: false,
  };
  const md =
    [
      "# Revisión de 19 pares Woo (sin aplicar)",
      "",
      `Mantener: ${summary.judgments.MANTENER}; revisión: ${summary.judgments.REVISION}; posibles propuestas: ${summary.judgments.POSIBLE_PROPUESTA}.`,
      "",
      "Son resultados de fuentes conservadas; no cambian IDs, agrupación, existencias ni elegibilidad.",
      "",
      ...result.groups.flatMap((g) => [
        `- ${g.cause}: ${g.codes.join(", ")}.`,
        "",
      ]),
      "## Consultas agrupadas",
      "",
      ...questions.flatMap((q, i) => [
        `${i + 1}. ${q.question}`,
        `Ejemplos: ${q.examples.join(" / ")}.`,
        ...q.options.map(
          (o, j) => `${String.fromCharCode(65 + j)}. ${o.label}`,
        ),
        q.answer_scope,
        "",
      ]),
    ].join("\n") + "\n";
  const files = {
    "plan.json": JSON.stringify(result, null, 2) + "\n",
    "resumen.json": JSON.stringify(summary, null, 2) + "\n",
    "preguntas-agrupadas.json": JSON.stringify(questions, null, 2) + "\n",
    "grupos.md": md,
  };
  mkdirSync(out, { mode: 0o700 });
  for (const [n, b] of Object.entries(files))
    writeFileSync(join(out, n), b, { mode: 0o600, flag: "wx" });
  const codePins = [
    "review-woo-pair-changes.mjs",
    "review-woo-pair-changes-report.mjs",
    "catalogo-cobertura-pages.mjs",
    "woo-test/plan.mjs",
  ].map((n) => {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), n);
    return { path, sha256: sha(readFileSync(path)) };
  });
  writeFileSync(
    join(out, "manifest.json"),
    JSON.stringify(
      {
        protocol: "m9-woo-pair-review-manifest-1",
        pins,
        code_pins: codePins,
        files: Object.entries(files).map(([name, b]) => ({
          name,
          sha256: sha(b),
        })),
        write_allowed: false,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  return summary;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  must(process.argv.length === 4, "Usage: PINNED_CONFIG NEW_OUTPUT");
  console.log(
    JSON.stringify(
      await prepareWooPairReview(
        resolve(process.argv[2]),
        resolve(process.argv[3]),
      ),
    ),
  );
}
