import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { collectReviewAnswers } from "./prepare-review-backlog.mjs";

// This records human testimony only. No database payload or source edits.
export async function saveReviewAnswers(packetPath, answerPath, output) {
  const bytes = await readFile(packetPath);
  const manifest = JSON.parse(
    await readFile(resolve(dirname(packetPath), "sha256.json")),
  );
  const sha = (v) => createHash("sha256").update(v).digest("hex");
  if (sha(bytes) !== manifest[basename(packetPath)])
    throw Error("PACKET_HASH_CHANGED");
  const packet = JSON.parse(bytes),
    answerBytes = await readFile(answerPath);
  const recorded = collectReviewAnswers(packet, JSON.parse(answerBytes));
  const result = {
    version: "m9-review-answers-1",
    packet_sha256: packet.packet_sha256,
    input_sha256: sha(answerBytes),
    recorded_answers: recorded.length,
    pending_cases: packet.cases.length - recorded.length,
    approved_for_import: 0,
    write_allowed: false,
    send_allowed: false,
    answers: recorded,
  };
  const content = JSON.stringify(result, null, 2) + "\n";
  await mkdir(output);
  await writeFile(resolve(output, "respuestas-registradas.json"), content, {
    flag: "wx",
  });
  await writeFile(
    resolve(output, "sha256.json"),
    JSON.stringify({ "respuestas-registradas.json": sha(content) }, null, 2) +
      "\n",
    { flag: "wx" },
  );
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [packet, answers, output] = process.argv.slice(2);
  if (!output)
    throw Error("Usage: VERIFIED_PACKET.json ANSWERS.json NEW_OUTPUT");
  const result = await saveReviewAnswers(
    resolve(packet),
    resolve(answers),
    resolve(output),
  );
  console.log({
    recorded_answers: result.recorded_answers,
    pending_cases: result.pending_cases,
    approved_for_import: 0,
  });
}
