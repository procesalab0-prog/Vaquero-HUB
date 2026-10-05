import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { claimedInput } from "./staging-bridge.mjs";
import { hash, assert } from "./plan.mjs";
import { wooClient } from "./worker.mjs";
import { prepareRevalidation } from "./revalidation.mjs";
const [claimFile, previousDir, runtimeDir, outputFile, reason] =
  process.argv.slice(2);
assert(
  process.argv.length === 7,
  "Usage: CLAIM PREVIOUS_DIR LOCAL_RUNTIME NEW_OUTPUT_FILE REASON",
);
const read = async (p) => JSON.parse(await readFile(resolve(p), "utf8"));
const claim = await read(claimFile);
const baseline = {
  input: await read(resolve(previousDir, "worker-input.json")),
  evidence: await read(resolve(previousDir, "verification.json")),
};
const input = claimedInput(claim, baseline);
const auth = await read(resolve(runtimeDir, "private/auth.json"));
const record = await prepareRevalidation({
  input,
  previousEvidenceHash: hash(baseline.evidence),
  reason,
  request: wooClient(
    input.store,
    "Basic " +
      Buffer.from(`${auth.username}:${auth.password}`).toString("base64"),
  ),
});
await writeFile(resolve(outputFile), JSON.stringify(record, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(
  JSON.stringify({
    mode: "LOCAL_READ_ONLY",
    resources: record.resources.length,
    sha256: hash(record),
    writes: 0,
  }),
);
