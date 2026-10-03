import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { assert, compilePlan, hash, localStore, VERSION } from "./plan.mjs";

export function wooClient(store, authorization = "") {
  const origin = localStore(store);
  return async (method, path, body) => {
    assert(
      ["GET", "POST", "PUT"].includes(method) &&
        /^products(?:\/[1-9][0-9]*(?:\/variations(?:\/[1-9][0-9]*)?)?)?$/.test(
          path,
        ),
      "UNSUPPORTED_WOO_OPERATION",
    );
    const url = `${origin}/wp-json/wc/v3/${path}`;
    const options = {
      method,
      redirect: method === "GET" ? "manual" : "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    let response = await fetch(url, options);
    // Playground can issue one same-URL redirect on its first request after boot.
    // Retry only a GET to the EXACT original URL; never follow another destination.
    if (
      method === "GET" &&
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.get("location") &&
      new URL(response.headers.get("location"), url).href === url
    ) {
      response = await fetch(url, { ...options, redirect: "error" });
    }
    // Never persist response bodies on error: plugins can echo secrets.
    if (!response.ok) throw new Error(`WOO_HTTP_${response.status}`);
    return response.json();
  };
}
async function save(file, data) {
  const temp = `${file}.tmp`;
  const handle = await open(temp, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(data, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
  const directory = await open(resolve(file, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
const safeError = (e) =>
  /^(WOO_HTTP_[0-9]{3}|REMOTE_CHANGED|VERIFY_FAILED|INVALID_RESPONSE_ID)$/.test(
    e?.message,
  )
    ? e.message
    : "TRANSPORT_OR_STORAGE_ERROR";
function matches(wanted, actual, key = "") {
  if (
    ["description", "short_description"].includes(key) &&
    typeof wanted === "string" &&
    typeof actual === "string"
  )
    return wanted.replace(/\n+$/, "") === actual.replace(/\n+$/, "");
  if (key === "regular_price")
    return (
      typeof actual === "string" &&
      /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(actual) &&
      Number(wanted) === Number(actual)
    );
  if (Array.isArray(wanted)) {
    if (!Array.isArray(actual)) return false;
    if (key === "meta_data")
      return wanted.every((item) =>
        actual.some((a) => a.key === item.key && matches(item, a)),
      );
    return (
      wanted.length === actual.length &&
      wanted.every((v, i) => matches(v, actual[i]))
    );
  }
  if (wanted && typeof wanted === "object")
    return (
      actual &&
      Object.entries(wanted).every(([k, v]) => matches(v, actual[k], k))
    );
  return wanted === actual;
}

// Single-host local rehearsal. This is deliberately NOT a distributed production outbox.
// Lock files survive crashes and require operator inspection; never expire a live lease.
export async function runJob({ input, journalDir, request }) {
  const plan = compilePlan(input);
  request ??= wooClient(input.store);
  await mkdir(journalDir, { recursive: true, mode: 0o700 });
  const file = resolve(
    journalDir,
    `${hash([plan.store.id, plan.product_id])}.json`,
  );
  const lock = await open(`${file}.lock`, "wx", 0o600).catch(() => {
    throw new Error("WORKER_LOCKED");
  });
  try {
    let ledger;
    try {
      ledger = JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      ledger = {
        version: VERSION,
        store: plan.store,
        product_id: plan.product_id,
        jobs: [],
      };
    }
    assert(
      ledger.version === VERSION &&
        hash(ledger.store) === hash(plan.store) &&
        ledger.product_id === plan.product_id,
      "JOURNAL_STORE_CHANGED",
    );
    let job = ledger.jobs.find((j) => j.revision === plan.revision);
    if (job) assert(job.plan_hash === hash(plan), "REVISION_CONTENT_CHANGED");
    else {
      assert(
        ledger.jobs.every((j) => j.state === "SUCCEEDED") &&
          ledger.jobs.every((j) => j.revision < plan.revision),
        "PRIOR_JOB_UNRESOLVED",
      );
      assert(
        plan.mode !== "create" || ledger.jobs.length === 0,
        "PRODUCT_ALREADY_SUBMITTED",
      );
      const previous = ledger.jobs.at(-1);
      if (previous)
        assert(
          input.target.product_id === previous.steps[0].remote_id,
          "TARGET_CHANGED",
        );
      job = {
        revision: plan.revision,
        plan_hash: hash(plan),
        state: "PENDING",
        steps: plan.steps.map((s) => ({ key: s.key, state: "PENDING" })),
        events: [],
      };
      ledger.jobs.push(job);
      await save(file, ledger);
    }
    if (job.state === "SUCCEEDED" || job.state === "REVIEW_REQUIRED")
      return structuredClone(job);
    // Process termination after dispatch is an uncertain write, even without an HTTP error.
    if (job.steps.some((s) => s.state === "DISPATCHING")) {
      job.state = "REVIEW_REQUIRED";
      job.events.push({ event: "INTERRUPTED_WRITE_REQUIRES_REVIEW" });
      await save(file, ledger);
      return structuredClone(job);
    }
    // Check every selected update target BEFORE the first mutation in this run.
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (!step.expected || job.steps[i].state === "SUCCEEDED") continue;
      try {
        const current = await request("GET", step.path);
        assert(hash(current) === hash(step.expected), "REMOTE_CHANGED");
      } catch (e) {
        job.state =
          e.message === "REMOTE_CHANGED" ? "REVIEW_REQUIRED" : "PENDING";
        job.events.push({ event: "PREFLIGHT_FAILED", code: safeError(e) });
        await save(file, ledger);
        return structuredClone(job);
      }
    }
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i],
        progress = job.steps[i];
      if (progress.state === "SUCCEEDED") continue;
      const path = step.parent_ref
        ? `products/${job.steps[0].remote_id}/${step.path}`
        : step.path;
      progress.state = "DISPATCHING";
      job.state = "RUNNING";
      job.events.push({ event: "DISPATCH", step: step.key });
      await save(file, ledger);
      try {
        const result = await request(step.method, path, step.payload);
        assert(
          Number.isSafeInteger(result.id) &&
            result.id > 0 &&
            (!step.expected || result.id === step.expected.id),
          "INVALID_RESPONSE_ID",
        );
        progress.remote_id = result.id;
        await save(file, ledger);
        const remote = await request(
          "GET",
          step.method === "POST" ? `${path}/${result.id}` : path,
        );
        assert(
          remote.id === result.id && matches(step.payload, remote),
          "VERIFY_FAILED",
        );
        progress.state = "SUCCEEDED";
        progress.verified_sha256 = hash(remote);
        job.events.push({
          event: "VERIFIED",
          step: step.key,
          remote_id: result.id,
        });
        await save(file, ledger);
      } catch (e) {
        progress.state = "REVIEW_REQUIRED";
        job.state = "REVIEW_REQUIRED";
        job.events.push({
          event: "WRITE_OUTCOME_REQUIRES_REVIEW",
          step: step.key,
          code: safeError(e),
        });
        await save(file, ledger);
        return structuredClone(job);
      }
    }
    job.state = "SUCCEEDED";
    await save(file, ledger);
    return structuredClone(job);
  } finally {
    await lock.close();
    await unlink(`${file}.lock`);
  }
}

// Read-only remote reconciliation of an explicitly identified uncertain result.
// An unknown remote ID is never guessed and an absent result never authorizes re-POST.
export async function reconcileKnownResult({
  input,
  journalDir,
  stepKey,
  remoteId,
  request,
}) {
  const plan = compilePlan(input);
  assert(Number.isSafeInteger(remoteId) && remoteId > 0, "INVALID_RESPONSE_ID");
  request ??= wooClient(input.store);
  const file = resolve(
    journalDir,
    `${hash([plan.store.id, plan.product_id])}.json`,
  );
  const lock = await open(`${file}.lock`, "wx", 0o600).catch(() => {
    throw new Error("WORKER_LOCKED");
  });
  try {
    const ledger = JSON.parse(await readFile(file, "utf8"));
    assert(
      ledger.version === VERSION && hash(ledger.store) === hash(plan.store),
      "JOURNAL_STORE_CHANGED",
    );
    const job = ledger.jobs.find((j) => j.revision === plan.revision);
    assert(job?.plan_hash === hash(plan), "REVISION_CONTENT_CHANGED");
    const i = plan.steps.findIndex((s) => s.key === stepKey);
    assert(
      i >= 0 &&
        job.state === "REVIEW_REQUIRED" &&
        ["REVIEW_REQUIRED", "DISPATCHING"].includes(job.steps[i].state),
      "NO_UNCERTAIN_WRITE",
    );
    const step = plan.steps[i],
      progress = job.steps[i];
    assert(
      !progress.remote_id || progress.remote_id === remoteId,
      "TARGET_CHANGED",
    );
    if (step.expected) assert(step.expected.id === remoteId, "TARGET_CHANGED");
    const path = step.parent_ref
      ? `products/${job.steps[0].remote_id}/${step.path}`
      : step.path;
    const remote = await request(
      "GET",
      step.method === "POST" ? `${path}/${remoteId}` : path,
    );
    assert(
      remote.id === remoteId && matches(step.payload, remote),
      "VERIFY_FAILED",
    );
    progress.remote_id = remoteId;
    progress.state = "SUCCEEDED";
    progress.verified_sha256 = hash(remote);
    job.events.push({
      event: "RECONCILED_BY_VERIFIED_ID",
      step: stepKey,
      remote_id: remoteId,
    });
    job.state = job.steps.every((s) => s.state === "SUCCEEDED")
      ? "SUCCEEDED"
      : "PENDING";
    await save(file, ledger);
    return structuredClone(job);
  } finally {
    await lock.close();
    await unlink(`${file}.lock`);
  }
}
