import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { stable } from "./woo-test/plan.mjs";

const sha = (v) => createHash("sha256").update(v).digest("hex");
export function ownerQuestions(families, priority, pending, cut) {
  const byCode = new Map(pending.map((r) => [r.barcode, r]));
  if (byCode.size !== pending.length || pending.length !== cut.expected_count)
    throw Error("PENDING_PARTITION_CHANGED");
  const priorities = new Set(priority.cases.map((c) => c.case_id));
  const selected = families.filter(
    (c) => c.kind === "EXPLICIT_T_PROPOSAL" && !c.issues.length,
  );
  // This previously consulted family is still pending, never treated as answered.
  const hold = families.find((c) => c.product_name_proposed === "CAWRNIÑO3587");
  if (hold && !selected.includes(hold)) selected.push(hold);
  const seen = new Set();
  const questions = selected
    .map((c) => {
      if (!c.members.length || c.members.length > 40)
        throw Error("UNBOUNDED_QUESTION");
      const members = c.members.map((m) => {
        const source = byCode.get(m.barcode);
        if (
          !source ||
          seen.has(m.barcode) ||
          source.description !== m.description ||
          source.department !== c.department ||
          source.section !== c.section ||
          source.retail_source !== m.retail_source ||
          !m.proposed ||
          m.proposed.base !== c.product_name_proposed ||
          m.description !== `${m.proposed.base}T.${m.proposed.suffix}`
        )
          throw Error("QUESTION_SOURCE_CHANGED");
        seen.add(m.barcode);
        return {
          barcode: m.barcode,
          size: m.proposed.suffix,
          source_evidence: source,
        };
      });
      if (new Set(members.map((m) => m.size)).size !== members.length)
        throw Error("DUPLICATE_SIZE");
      return {
        question_id: c.case_id,
        title: c.product_name_proposed,
        question: "¿Es un solo modelo y sólo cambia la talla indicada?",
        help: "Confirma el modelo completo de esta tarjeta. Si hay colores, líneas o modelos diferentes, elige «Hay algo que corregir» y explica la diferencia. No hace falta revisar cada código por separado.",
        department: c.department,
        section: c.section,
        priority: priorities.has(c.case_id),
        previously_consulted: c === hold,
        source_case_sha: c.evidence_sha256,
        members,
      };
    })
    .sort(
      (a, b) =>
        Number(b.priority) - Number(a.priority) ||
        a.question_id.localeCompare(b.question_id),
    );
  if (
    priorities.size !== priority.cases.length ||
    questions.filter((q) => q.priority).length !== priorities.size
  )
    throw Error("PRIORITY_CASES_CHANGED");
  const body = {
    version: "m9-owner-questions-1",
    cut_sha: cut.cut_sha,
    questions,
    summary: {
      pending_rows: pending.length,
      questions: questions.length,
      covered_rows: seen.size,
      priority_questions: priorities.size,
      priority_rows: questions
        .filter((q) => q.priority)
        .reduce((n, q) => n + q.members.length, 0),
      technical_rows: pending.length - seen.size,
      approved_for_import: 0,
    },
    import_allowed: false,
    send_allowed: false,
  };
  return { ...body, packet_sha256: sha(stable(body)) };
}
export async function prepareOwnerQuestions(configPath, output) {
  const config = JSON.parse(await readFile(configPath));
  const inputs = {};
  for (const key of ["families", "priority", "pending", "cut"]) {
    const input = config.inputs[key],
      bytes = await readFile(resolve(dirname(configPath), input.path));
    if (sha(bytes) !== input.sha256) throw Error("INPUT_HASH_CHANGED");
    inputs[key] = JSON.parse(bytes);
  }
  const packet = ownerQuestions(
    inputs.families,
    inputs.priority,
    inputs.pending,
    inputs.cut,
  );
  await mkdir(output);
  const files = {
    "preguntas.json": JSON.stringify(packet, null, 2) + "\n",
    "resumen.json": JSON.stringify(packet.summary, null, 2) + "\n",
  };
  for (let i = 0; i < packet.questions.length; i += 20) {
    const rows = JSON.stringify(packet.questions.slice(i, i + 20)).replaceAll(
      "'",
      "''",
    );
    files[`lote-${String(i / 20 + 1).padStart(3, "0")}.sql`] =
      `select app.load_m9_owner_questions('${packet.cut_sha}', '${rows}'::jsonb);\n`;
  }
  files["sha256.json"] =
    JSON.stringify(
      Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])),
      null,
      2,
    ) + "\n";
  for (const [name, body] of Object.entries(files))
    await writeFile(resolve(output, name), body, { flag: "wx" });
  return packet.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [config, output] = process.argv.slice(2);
  if (!output) throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT");
  console.log(await prepareOwnerQuestions(resolve(config), resolve(output)));
}
