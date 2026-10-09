import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stable } from "./woo-test/plan.mjs";
const sha = (v) => createHash("sha256").update(v).digest("hex");
export function reviewOwnerAnswers(packet, exported) {
  const { packet_sha256, ...body } = packet;
  if (
    sha(stable(body)) !== packet_sha256 ||
    packet.version !== "m9-owner-questions-1"
  )
    throw Error("PACKET_CHANGED");
  if (
    exported.version !== "m9-owner-answer-export-1" ||
    exported.cut_sha !== packet.cut_sha ||
    exported.approved_for_import !== 0 ||
    exported.send_allowed !== false ||
    !Array.isArray(exported.questions)
  )
    throw Error("INVALID_ANSWER_EXPORT");
  const byId = new Map(packet.questions.map((q) => [q.question_id, q])),
    seen = new Set(),
    cases = [];
  for (const item of exported.questions) {
    const q = byId.get(item.question_id);
    if (
      !q ||
      seen.has(item.question_id) ||
      stable(q) !== stable(item.evidence) ||
      !Number.isSafeInteger(item.batch) ||
      item.batch < 1 ||
      !Array.isArray(item.answers)
    )
      throw Error("ANSWER_EVIDENCE_CHANGED");
    seen.add(item.question_id);
    for (let i = 0; i < item.answers.length; i++) {
      const a = item.answers[i];
      if (
        Object.keys(a).sort().join(",") !==
          "actor,choice,commercial_name,created_at,note,revision" ||
        a.revision !== i + 1 ||
        !/^[a-f0-9-]{36}$/.test(a.actor) ||
        !["SAME_MODEL", "CORRECTION", "UNSURE"].includes(a.choice) ||
        typeof a.note !== "string" ||
        a.note.length > 2000 ||
        (a.choice === "CORRECTION" && a.note.trim().length < 5) ||
        typeof a.commercial_name !== "string" ||
        a.commercial_name.length > 200 ||
        !Number.isFinite(Date.parse(a.created_at))
      )
        throw Error("INVALID_ANSWER_HISTORY");
    }
    const latest = item.answers.at(-1);
    cases.push({
      question_id: q.question_id,
      title: q.title,
      source_case_sha: q.source_case_sha,
      batch: item.batch,
      status: !latest
        ? "AWAITING_OWNER"
        : latest.choice === "SAME_MODEL"
          ? "REQUIRES_TECHNICAL_PLAN"
          : latest.choice === "CORRECTION"
            ? "REQUIRES_SOURCE_CORRECTION"
            : "AWAITING_CONSULTATION",
      members: q.members,
      latest_answer: latest ?? null,
      history: item.answers,
      import_allowed: false,
      send_allowed: false,
    });
  }
  return {
    version: "m9-owner-answer-review-1",
    cut_sha: packet.cut_sha,
    packet_sha256,
    summary: {
      released_questions: cases.length,
      answers: cases.filter((c) => c.latest_answer).length,
      technical_review: cases.filter(
        (c) => c.status === "REQUIRES_TECHNICAL_PLAN",
      ).length,
      corrections: cases.filter(
        (c) => c.status === "REQUIRES_SOURCE_CORRECTION",
      ).length,
      approved_for_import: 0,
    },
    cases,
    import_allowed: false,
    send_allowed: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [packetPath, exportPath, output] = process.argv.slice(2);
  if (!output)
    throw Error("Usage: PACKET.json READ_ONLY_EXPORT.json NEW_OUTPUT");
  const packet = await readFile(packetPath),
    answers = await readFile(exportPath),
    reviewed = reviewOwnerAnswers(JSON.parse(packet), JSON.parse(answers));
  await mkdir(output);
  const content =
    JSON.stringify(
      {
        ...reviewed,
        input_sha256: { packet: sha(packet), answers: sha(answers) },
      },
      null,
      2,
    ) + "\n";
  await writeFile(resolve(output, "revision-respuestas.json"), content, {
    flag: "wx",
  });
  await writeFile(
    resolve(output, "sha256.json"),
    JSON.stringify({ "revision-respuestas.json": sha(content) }, null, 2) +
      "\n",
    { flag: "wx" },
  );
  console.log(reviewed.summary);
}
