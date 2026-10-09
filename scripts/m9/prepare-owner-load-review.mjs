import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { coverageReview } from "./prepare-coverage-review.mjs";
import { reviewOwnerAnswers } from "./review-owner-answers.mjs";
import { planSicarOnly } from "./plan-sicar-only.mjs";
import { stable } from "./woo-test/plan.mjs";
const sha = (v) => createHash("sha256").update(v).digest("hex");
const json = (v) => JSON.stringify(v, null, 2) + "\n";
const nameKey = (s) => s.normalize("NFC").trim().toUpperCase();

// Read-only bridge. An owner's model confirmation is evidence, not a technical
// approval. Templates deliberately remain pending and fail the existing planner.
export function ownerLoadReview(packet, exported, inputs) {
  if (inputs.rowsCutSha !== packet.cut_sha)
    throw Error("OWNER_SOURCE_CUT_CHANGED");
  const answers = reviewOwnerAnswers(packet, exported);
  const coverage = coverageReview(
    inputs.rows,
    inputs.applied,
    inputs.snapshot,
    inputs.taxonomy,
    50,
    inputs.holds,
  );
  const families = new Map(coverage.cases.map((c) => [c.case_id, c]));
  const source = new Map(inputs.rows.map((r) => [r.barcode, r]));
  const questions = new Map();
  const seenCodes = new Set();
  // Validate the reserved bank too, without releasing its questions or treating
  // a shared base/name as authorization to merge two source families.
  const bank = packet.questions.map((q) => {
    const c = families.get(q.question_id);
    if (
      questions.has(q.question_id) ||
      !c ||
      c.kind !== "EXPLICIT_T_PROPOSAL" ||
      c.product_name_proposed !== q.title ||
      c.evidence_sha256 !== q.source_case_sha ||
      c.department !== q.department ||
      c.section !== q.section ||
      c.members.length !== q.members.length
    )
      throw Error("QUESTION_FAMILY_CHANGED");
    questions.set(q.question_id, q);
    for (const m of q.members) {
      const r = source.get(m.barcode),
        member = c.members.find((x) => x.barcode === m.barcode);
      if (
        !r ||
        !member ||
        seenCodes.has(m.barcode) ||
        member.proposed?.suffix !== m.size ||
        r.classification !== "SICAR_ONLY" ||
        stable(m.source_evidence) !==
          stable({
            barcode: r.barcode,
            description: r.description,
            department: r.fields.departamento,
            section: r.fields.categoria,
            retail_source: r.fields.precio1,
            price_cents: member.retail_cents,
            classification: r.classification,
            reasons: [...(r.issues ?? []), ...(r.commercial_checks ?? [])],
            candidate_woo_ids: r.candidate_product_ids ?? [],
          })
      )
        throw Error("QUESTION_MEMBER_CHANGED");
      seenCodes.add(m.barcode);
    }
    return {
      question_id: q.question_id,
      rows: q.members.length,
      technical_issues: c.issues,
      import_allowed: false,
    };
  });
  const names = new Set(inputs.snapshot.products.map((p) => nameKey(p.name)));
  const proposedNames = new Map();
  for (const c of answers.cases) {
    if (c.status !== "REQUIRES_TECHNICAL_PLAN") continue;
    const n =
      c.latest_answer.commercial_name.trim() ||
      questions.get(c.question_id).title;
    proposedNames.set(nameKey(n), (proposedNames.get(nameKey(n)) ?? 0) + 1);
  }
  const drafts = [];
  const tasks = answers.cases.map((c) => {
    const q = questions.get(c.question_id),
      family = families.get(c.question_id),
      issues = new Set(family.issues),
      confirmed = c.status === "REQUIRES_TECHNICAL_PLAN";
    const proposedName = confirmed
      ? c.latest_answer.commercial_name.trim() || q.title
      : null;
    if (confirmed) {
      if (proposedName.length > 160) issues.add("PRODUCT_NAME_LIMIT");
      if (names.has(nameKey(proposedName)))
        issues.add("DESTINATION_NAME_REVIEW");
      if (proposedNames.get(nameKey(proposedName)) !== 1)
        issues.add("ANSWER_NAME_COLLISION_REVIEW");
      if (c.latest_answer.note.trim()) issues.add("OWNER_NOTE_REVIEW");
      if (
        q.members.some(
          (m) => !/^(XS|S|M|L|XL|XXL|XXXL|\d+(?:\.\d+)?)$/.test(m.size),
        )
      )
        issues.add("ATTRIBUTE_DIMENSIONS_REVIEW");
    }
    if (confirmed && !issues.size) {
      drafts.push({
        family_key: "sicar-" + q.question_id.slice(0, 40),
        product_name: proposedName,
        evidence_sha256: family.evidence_sha256,
        members: q.members.map((m) => ({
          barcode: m.barcode,
          attributes: { TALLA: m.size },
        })),
        status: "pending",
        reviewer: "",
        reviewed_at: "",
        reason: "",
      });
    }
    return {
      question_id: q.question_id,
      title: q.title,
      batch: c.batch,
      status: confirmed
        ? issues.size
          ? "TECHNICAL_REVIEW_BLOCKED"
          : "DRAFT_REQUIRES_TECHNICAL_APPROVAL"
        : c.status,
      issues: [...issues].sort(),
      members: q.members.map((m) => ({ barcode: m.barcode, size: m.size })),
      latest_answer: c.latest_answer,
      answer_binding_sha256: sha(
        stable({ cut: packet.cut_sha, question: q, history: c.history }),
      ),
      import_allowed: false,
      send_allowed: false,
    };
  });
  const planner = planSicarOnly(coverage.review, drafts);
  if (planner.families.length || planner.summary.reviewed_rows)
    throw Error("PENDING_DRAFT_BECAME_APPROVED");
  return {
    version: "m9-owner-load-review-1",
    mode: "READ_ONLY",
    cut_sha: packet.cut_sha,
    packet_sha256: packet.packet_sha256,
    destination_sha256: sha(stable(inputs.snapshot)),
    summary: {
      source_rows: coverage.summary.source_rows,
      staged_rows: coverage.summary.staged_rows,
      bank_questions_revalidated: bank.length,
      bank_rows_revalidated: seenCodes.size,
      released_questions: tasks.length,
      actual_answers: answers.summary.answers,
      draft_families: drafts.length,
      draft_rows: drafts.reduce((n, d) => n + d.members.length, 0),
      blocked_confirmations: tasks.filter(
        (t) => t.status === "TECHNICAL_REVIEW_BLOCKED",
      ).length,
      imported_new_rows: 0,
      approved_for_import: 0,
    },
    bank_audit: bank,
    tasks,
    pending_decisions: drafts,
    planner_rejections: planner.errors,
    import_allowed: false,
    send_allowed: false,
    inventory_included: false,
  };
}
export async function prepareOwnerLoadReview(configPath, output) {
  const config = JSON.parse(await readFile(configPath));
  const inputs = {},
    hashes = {};
  for (const key of [
    "packet",
    "answers",
    "rows",
    "applied",
    "snapshot",
    "taxonomy",
    "holds",
  ]) {
    const input = config.inputs[key],
      bytes = await readFile(resolve(dirname(configPath), input.path));
    hashes[key] = sha(bytes);
    if (hashes[key] !== input.sha256) throw Error("INPUT_HASH_CHANGED");
    inputs[key] = JSON.parse(bytes);
  }
  const result = ownerLoadReview(inputs.packet, inputs.answers, {
    ...inputs,
    rowsCutSha: hashes.rows,
  });
  await mkdir(output);
  const files = {
    "revision-tecnica.json": json({ ...result, input_sha256: hashes }),
    "decisiones-pendientes.json": json(result.pending_decisions),
    "resumen.json": json(result.summary),
    "siguiente-paso.txt":
      "Sólo lectura. Las respuestas no autorizan cargas. Revisar las aclaraciones, renovar fuentes y destino, documentar la decisión técnica y ejecutar por separado el plan e importador existentes en staging. Sin respuestas no se prepara ninguna familia.\n",
  };
  files["sha256.json"] = json(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])),
  );
  for (const [name, body] of Object.entries(files))
    await writeFile(resolve(output, name), body, { flag: "wx" });
  return result.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [config, output] = process.argv.slice(2);
  if (!output) throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT");
  console.log(await prepareOwnerLoadReview(resolve(config), resolve(output)));
}
