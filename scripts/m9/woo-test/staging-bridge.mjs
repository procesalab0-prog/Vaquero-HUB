import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assert, compilePlan, hash, localStore } from "./plan.mjs";
import { runJob, wooClient } from "./worker.mjs";

export function sourceImage(url) {
  const u = new URL(url);
  assert(
    u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      ((u.hostname === "vaquerosm.com" &&
        u.pathname.startsWith("/wp-content/uploads/")) ||
        (u.hostname === "zsezjtswqeijboezvado.supabase.co" &&
          u.pathname.startsWith("/storage/v1/object/public/product-images/"))),
    "UNAPPROVED_IMAGE_SOURCE",
  );
  return u.href;
}
export function imageType(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return ["image/jpeg", "jpg"];
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
    return ["image/png", "png"];
  if (
    Buffer.from(bytes.slice(0, 4)).toString() === "RIFF" &&
    Buffer.from(bytes.slice(8, 12)).toString() === "WEBP"
  )
    return ["image/webp", "webp"];
  throw new Error("UNSUPPORTED_IMAGE_BYTES");
}
export function claimedInput(claim, baseline) {
  const p = claim?.packet;
  const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  assert(
    claim?.state === "RUNNING" &&
      uuid.test(claim.id) &&
      uuid.test(claim.claim_id),
    "CLAIM_REQUIRED",
  );
  assert(
    ((p?.version === 1 && p.mode === "create") ||
      (p?.version === 2 && p.mode === "update")) &&
      p.type === "simple" &&
      p.store?.id === "m9-local-2026-10-02" &&
      localStore(p.store) === "http://127.0.0.1:9417",
    "LOCAL_CLAIM_ONLY",
  );
  assert(
    p.category_evidence?.valid === true &&
      p.catalog?.active === true &&
      p.catalog.product_id === p.product_id &&
      p.catalog.variants?.length === 1 &&
      p.catalog.variants[0].active === true &&
      Object.keys(p.catalog.variants[0].attributes).length === 0,
    "CLAIM_REVIEW_REQUIRED",
  );
  p.content.images.forEach((i) => sourceImage(i.url));
  const v = p.catalog.variants[0];
  const input = {
    store: p.store,
    product_id: p.product_id,
    revision: p.revision,
    mode: p.mode,
    type: "simple",
    content: p.content,
    variants: [
      {
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        price_cents: v.price_cents,
        attributes: [],
      },
    ],
    bindings: {
      store_id: p.store.id,
      categories: p.content.categories.map((path, i) => ({ path, id: i + 1 })),
      images: p.content.images.map((x, i) => ({ url: x.url, id: i + 1 })),
    },
  };
  if (p.mode === "update") {
    assert(
      baseline &&
        hash(baseline.evidence) === p.previous?.receipt?.evidence_sha256 &&
        baseline.evidence.worker_result.state === "SUCCEEDED" &&
        hash(compilePlan(baseline.input)) ===
          baseline.evidence.worker_result.plan_hash &&
        baseline.input.product_id === p.product_id &&
        baseline.input.revision === p.previous.revision &&
        p.previous.revision < p.revision &&
        hash(baseline.input.store) === hash(p.store) &&
        baseline.evidence.parent.id === p.previous.receipt.local_product_id &&
        baseline.evidence.parent.id ===
          baseline.evidence.worker_result.steps[0].remote_id,
      "VERIFIED_PREVIOUS_RESULT_REQUIRED",
    );
    const parent = baseline.evidence.parent;
    input.target = {
      store_id: p.store.id,
      product_id: parent.id,
      snapshot: parent,
      variants: [{ variant_id: v.id, id: parent.id, snapshot: parent }],
    };
  }
  compilePlan(input); // Validate completely before any remote media/category writes.
  return input;
}
async function durable(file, value) {
  const h = await open(`${file}.tmp`, "w", 0o600);
  try {
    await h.writeFile(JSON.stringify(value, null, 2) + "\n");
    await h.sync();
  } finally {
    await h.close();
  }
  await rename(`${file}.tmp`, file);
  const dir = await open(resolve(file, ".."), "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}
async function download(url) {
  const response = await fetch(sourceImage(url), {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok, "IMAGE_READ_FAILED");
  assert(
    Number(response.headers.get("content-length") || 0) <= 4 * 1024 * 1024,
    "IMAGE_TOO_LARGE",
  );
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    assert(size <= 4 * 1024 * 1024, "IMAGE_TOO_LARGE");
    parts.push(part);
  }
  const bytes = Buffer.concat(parts);
  assert(bytes.length > 0, "EMPTY_IMAGE");
  imageType(bytes);
  return bytes;
}
export async function processClaim({
  claim,
  runtimeDir,
  outputDir,
  previousDir,
}) {
  const baseline = previousDir
    ? {
        input: JSON.parse(
          await readFile(resolve(previousDir, "worker-input.json"), "utf8"),
        ),
        evidence: JSON.parse(
          await readFile(resolve(previousDir, "verification.json"), "utf8"),
        ),
      }
    : undefined;
  const input = claimedInput(claim, baseline),
    origin = localStore(input.store),
    root = resolve(runtimeDir),
    out = resolve(outputDir);
  await mkdir(out, { recursive: true, mode: 0o700 });
  const lock = await open(resolve(out, "bridge.lock"), "wx", 0o600);
  try {
    const auth = JSON.parse(
      await readFile(resolve(root, "private/auth.json"), "utf8"),
    );
    const authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
    const request = wooClient(input.store, authorization);
    async function call(path, method = "GET", body, extra = {}) {
      assert(
        /^(m9-local\/v1\/isolation|wc\/v3\/products\/categories(?:\/[1-9][0-9]*)?|wp\/v2\/media(?:\/[1-9][0-9]*)?)$/.test(
          path,
        ),
        "UNSUPPORTED_BRIDGE_PATH",
      );
      const url = `${origin}/wp-json/${path}`;
      const options = {
        method,
        redirect: method === "GET" ? "manual" : "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          ...extra,
        },
        ...(body
          ? { body: body instanceof Uint8Array ? body : JSON.stringify(body) }
          : {}),
      };
      let r = await fetch(url, options);
      if (
        method === "GET" &&
        r.status >= 300 &&
        r.status < 400 &&
        r.headers.get("location") &&
        new URL(r.headers.get("location"), url).href === url
      )
        r = await fetch(url, { ...options, redirect: "error" });
      assert(r.ok, `LOCAL_HTTP_${r.status}`);
      return r.json();
    }
    const isolation = await call("m9-local/v1/isolation");
    assert(
      isolation.environment === "local" &&
        isolation.url === origin &&
        isolation.cron_disabled &&
        isolation.outbound_blocked &&
        isolation.mail_blocked &&
        isolation.payment_gateways === 0 &&
        !isolation.webhooks_enabled &&
        isolation.orders === 0,
      "ISOLATION_FAILED",
    );
    const journalFile = resolve(out, "assets.json");
    let journal;
    try {
      journal = JSON.parse(await readFile(journalFile, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      journal = { claim_hash: hash(claim), steps: {} };
    }
    assert(journal.claim_hash === hash(claim), "CLAIM_FILE_CHANGED");
    if (input.mode === "update" && !journal.preflight) {
      const current = await request(
        "GET",
        `products/${input.target.product_id}`,
      );
      assert(hash(current) === hash(input.target.snapshot), "REMOTE_CHANGED");
      journal.preflight = true;
      await durable(journalFile, journal);
    }
    async function asset(key, write, verify) {
      const prior = journal.steps[key];
      assert(
        !prior || prior.state === "SUCCEEDED",
        "ASSET_REVIEW_REQUIRED_NO_REPOST",
      );
      if (prior) {
        await verify(prior.id);
        return prior.id;
      }
      journal.steps[key] = { state: "DISPATCHING" };
      await durable(journalFile, journal);
      const result = await write();
      assert(
        Number.isSafeInteger(result.id) && result.id > 0,
        "INVALID_ASSET_ID",
      );
      journal.steps[key].id = result.id;
      await durable(journalFile, journal);
      await verify(result.id);
      journal.steps[key].state = "SUCCEEDED";
      await durable(journalFile, journal);
      return result.id;
    }
    input.bindings.categories = [];
    for (const path of input.content.categories) {
      // Verified paths with ancestry need an explicit hierarchy mapping, never flatten.
      assert(!path.includes(" > "), "CATEGORY_HIERARCHY_REVIEW_REQUIRED");
      const previous = baseline?.input.bindings.categories.find(
        (c) => c.path === path,
      );
      if (previous) {
        const current = await call(`wc/v3/products/categories/${previous.id}`);
        assert(
          current.id === previous.id &&
            current.name === path &&
            current.parent === 0,
          "CATEGORY_READBACK_FAILED",
        );
        input.bindings.categories.push(previous);
        continue;
      }
      const slug = `m9-${hash([input.store.id, claim.id, path]).slice(0, 20)}`;
      const id = await asset(
        `category:${path}`,
        () => call("wc/v3/products/categories", "POST", { name: path, slug }),
        async (id) => {
          const c = await call(`wc/v3/products/categories/${id}`);
          assert(
            c.name === path && c.slug === slug && c.parent === 0,
            "CATEGORY_READBACK_FAILED",
          );
        },
      );
      input.bindings.categories.push({ id, path });
    }
    input.bindings.images = [];
    for (const [i, img] of input.content.images.entries()) {
      const previous = baseline?.input.bindings.images.find(
        (m) => m.url === img.url,
      );
      if (previous) {
        const current = await call(`wp/v2/media/${previous.id}`);
        assert(
          current.id === previous.id &&
            current.media_type === "image" &&
            current.source_url?.startsWith(`${origin}/`),
          "IMAGE_READBACK_FAILED",
        );
        input.bindings.images.push(previous);
        continue;
      }
      let bytes;
      if (!journal.steps[`image:${img.url}`]) bytes = await download(img.url);
      const id = await asset(
        `image:${img.url}`,
        async () => {
          const [mime, ext] = imageType(bytes);
          return call("wp/v2/media", "POST", bytes, {
            "Content-Type": mime,
            "Content-Disposition": `attachment; filename="m9-${claim.id}-${i}.${ext}"`,
          });
        },
        async (id) => {
          const m = await call(`wp/v2/media/${id}`);
          assert(
            m.id === id &&
              m.source_url?.startsWith(`${origin}/`) &&
              m.media_type === "image",
            "IMAGE_READBACK_FAILED",
          );
        },
      );
      input.bindings.images.push({ id, url: img.url });
    }
    await durable(resolve(out, "worker-input.json"), input);
    const result = await runJob({
      input,
      journalDir: resolve(root, "private/worker-journal"),
      request,
    });
    await durable(resolve(out, "worker-result.json"), result);
    assert(result.state === "SUCCEEDED", "JOB_REVIEW_REQUIRED");
    const localId = result.steps[0].remote_id;
    const parent = await request("GET", `products/${localId}`);
    assert(
      parent.status === "draft" &&
        parent.type === "simple" &&
        parent.sku === input.variants[0].sku &&
        parent.meta_data.some(
          (m) =>
            m.key === "_mi_tienda_barcode" &&
            m.value === input.variants[0].barcode,
        ),
      "FINAL_IDENTITY_FAILED",
    );
    let repeatCalls = 0;
    await runJob({
      input,
      journalDir: resolve(root, "private/worker-journal"),
      request: async (...args) => {
        repeatCalls++;
        return request(...args);
      },
    });
    assert(repeatCalls === 0, "DUPLICATE_REQUEST");
    const evidence = {
      claim_hash: hash(claim),
      worker_result: result,
      parent,
      isolation,
      repeat_requests: repeatCalls,
      production_writes: 0,
      stock_payload_fields: 0,
    };
    await durable(resolve(out, "verification.json"), evidence);
    const receipt = {
      state: "SUCCEEDED",
      store_id: input.store.id,
      local_product_id: localId,
      variant_id: input.variants[0].id,
      evidence_sha256: hash(evidence),
    };
    await durable(resolve(out, "receipt.json"), receipt);
    return receipt;
  } finally {
    await lock.close();
    await unlink(resolve(out, "bridge.lock"));
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [claimFile, runtimeDir, outputDir, previousDir] = process.argv.slice(2);
  assert(
    claimFile && runtimeDir && outputDir,
    "Usage: staging-bridge.mjs CLAIM_JSON RUNTIME_DIR OUTPUT_DIR [PREVIOUS_VERIFIED_DIR]",
  );
  const claim = JSON.parse(await readFile(resolve(claimFile), "utf8"));
  console.log(
    JSON.stringify(
      await processClaim({ claim, runtimeDir, outputDir, previousDir }),
      null,
      2,
    ),
  );
}
