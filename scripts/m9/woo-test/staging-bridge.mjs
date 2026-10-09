import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assert, compilePlan, hash, localStore } from "./plan.mjs";
import { runJob, wooClient } from "./worker.mjs";
import { applyRevalidation } from "./revalidation.mjs";

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
    ((p?.version === 1 && p.type === "simple" && p.mode === "create") ||
      (p?.version === 2 && p.type === "simple" && p.mode === "update") ||
      (p?.version === 3 && p.type === "variable" && p.mode === "create") ||
      (p?.version === 4 && p.type === "variable" && p.mode === "update")) &&
      (p.type === "simple" || p.type === "variable") &&
      p.store?.id === "m9-local-2026-10-02" &&
      localStore(p.store) === "http://127.0.0.1:9417",
    "LOCAL_CLAIM_ONLY",
  );
  assert(
    p.category_evidence?.valid === true &&
      p.catalog?.active === true &&
      p.catalog.product_id === p.product_id &&
      Array.isArray(p.catalog.variants) &&
      p.catalog.variants.length > 0 &&
      p.catalog.variants.every((v) => v.active === true) &&
      (p.type === "simple"
        ? p.catalog.variants.length === 1 &&
          Object.keys(p.catalog.variants[0].attributes).length === 0
        : p.catalog.variants.length >= 2 &&
          p.family_evidence?.catalog_fingerprint === p.fingerprint &&
          p.family_evidence?.source_fingerprint === p.source_fingerprint &&
          /^[a-f0-9]{64}$/.test(p.family_evidence?.evidence_sha256)),
    "CLAIM_REVIEW_REQUIRED",
  );
  p.content.images.forEach((i) => sourceImage(i.url));
  categoryNodes(p.content.categories);
  const input = {
    store: p.store,
    product_id: p.product_id,
    revision: p.revision,
    mode: p.mode,
    type: p.type,
    content: p.content,
    variants: p.catalog.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      price_cents: v.price_cents,
      attributes: Object.entries(v.attributes)
        .map(([code, option]) => {
          const name = { TALLA: "Talla", COLOR: "Color", LARGO: "Largo" }[code];
          assert(name, "UNSUPPORTED_ATTRIBUTE");
          return { name, option };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
    ...(p.type === "variable"
      ? {
          descriptive_attributes: (p.parent_attributes ?? [])
            .filter((a) => a.variation === false)
            .map((a) => ({ name: a.name, options: [a.option] })),
        }
      : {}),
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
      variants:
        p.type === "simple"
          ? [
              {
                variant_id: input.variants[0].id,
                id: parent.id,
                snapshot: parent,
              },
            ]
          : input.variants.map((v) => {
              const receipt = p.previous.receipt.variants?.filter(
                (x) => x.variant_id === v.id,
              );
              const children = baseline.evidence.children?.filter(
                (x) => x.variant_id === v.id,
              );
              assert(
                receipt?.length === 1 &&
                  children?.length === 1 &&
                  receipt[0].local_variation_id === children[0].id,
                "VERIFIED_PREVIOUS_VARIANT_REQUIRED",
              );
              return children[0];
            }),
    };
  }
  compilePlan(input); // Validate completely before any remote media/category writes.
  return input;
}

export function categoryNodes(paths) {
  const nodes = new Map();
  assert(Array.isArray(paths) && paths.length > 0, "INVALID_CATEGORY_PATH");
  for (const path of paths) {
    const parts = path.split(" > ");
    assert(
      parts.length <= 10 &&
        parts.every((s) => s && s.trim() === s && !s.includes(">")),
      "INVALID_CATEGORY_PATH",
    );
    for (let i = 0; i < parts.length; i++) {
      const full = parts.slice(0, i + 1).join(" > ");
      nodes.set(full, {
        path: full,
        name: parts[i],
        parent_path: parts.slice(0, i).join(" > "),
      });
    }
  }
  return [...nodes.values()].sort(
    (a, b) =>
      a.path.split(" > ").length - b.path.split(" > ").length ||
      a.path.localeCompare(b.path),
  );
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
  revalidationFile,
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
  let input = claimedInput(claim, baseline);
  const revalidation = revalidationFile
    ? JSON.parse(await readFile(resolve(revalidationFile), "utf8"))
    : null;
  if (revalidation) {
    input = applyRevalidation(input, revalidation, hash(baseline.evidence));
    compilePlan(input);
  }
  const origin = localStore(input.store),
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
    const revalidationHash = revalidation ? hash(revalidation) : null;
    if (Object.hasOwn(journal, "revalidation_sha256"))
      assert(
        journal.revalidation_sha256 === revalidationHash,
        "REVALIDATION_CHANGED",
      );
    else {
      assert(
        (!journal.preflight && Object.keys(journal.steps).length === 0) ||
          !revalidation,
        "REVALIDATION_CHANGED",
      );
      journal.revalidation_sha256 = revalidationHash;
      await durable(journalFile, journal);
    }
    if (input.mode === "update" && !journal.preflight) {
      const current = await request(
        "GET",
        `products/${input.target.product_id}`,
      );
      assert(hash(current) === hash(input.target.snapshot), "REMOTE_CHANGED");
      if (input.type === "variable")
        for (const child of input.target.variants) {
          const currentChild = await request(
            "GET",
            `products/${input.target.product_id}/variations/${child.id}`,
          );
          assert(hash(currentChild) === hash(child.snapshot), "REMOTE_CHANGED");
        }
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
    const nodes = categoryNodes(input.content.categories),
      categoryBindings = new Map();
    for (const node of nodes) {
      const parent = node.parent_path
        ? categoryBindings.get(node.parent_path).id
        : 0;
      const previous = (
        baseline?.evidence.category_nodes ??
        baseline?.input.bindings.categories ??
        []
      ).find((c) => c.path === node.path);
      if (previous) {
        const current = await call(`wc/v3/products/categories/${previous.id}`);
        assert(
          current.id === previous.id &&
            current.name === node.name &&
            current.parent === parent,
          "CATEGORY_READBACK_FAILED",
        );
        categoryBindings.set(node.path, { id: previous.id, path: node.path });
        continue;
      }
      const slug = `m9-${hash([input.store.id, claim.id, node.path]).slice(0, 20)}`;
      const id = await asset(
        `category:${node.path}`,
        () =>
          call("wc/v3/products/categories", "POST", {
            name: node.name,
            slug,
            parent,
          }),
        async (id) => {
          const c = await call(`wc/v3/products/categories/${id}`);
          assert(
            c.name === node.name && c.slug === slug && c.parent === parent,
            "CATEGORY_READBACK_FAILED",
          );
        },
      );
      categoryBindings.set(node.path, { id, path: node.path });
    }
    input.bindings.categories = input.content.categories.map((path) =>
      categoryBindings.get(path),
    );
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
      parent.status === "draft" && parent.type === input.type,
      "FINAL_IDENTITY_FAILED",
    );
    const children = [];
    for (const v of input.variants) {
      const id =
        input.type === "simple"
          ? localId
          : result.steps.find((step) => step.key === v.id)?.remote_id;
      assert(Number.isSafeInteger(id) && id > 0, "FINAL_IDENTITY_FAILED");
      const snapshot =
        input.type === "simple"
          ? parent
          : await request("GET", `products/${localId}/variations/${id}`);
      assert(
        snapshot.sku === v.sku &&
          snapshot.meta_data.some(
            (m) => m.key === "_mi_tienda_barcode" && m.value === v.barcode,
          ) &&
          snapshot.meta_data.some(
            (m) => m.key === "_mi_tienda_variant_id" && m.value === v.id,
          ),
        "FINAL_IDENTITY_FAILED",
      );
      children.push({ variant_id: v.id, id, snapshot });
    }
    if (input.type === "variable")
      assert(
        hash([...parent.variations].sort((a, b) => a - b)) ===
          hash(children.map((c) => c.id).sort((a, b) => a - b)),
        "FINAL_FAMILY_CHANGED",
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
      ...(input.type === "variable" ? { children } : {}),
      category_nodes: [...categoryBindings.values()],
      isolation,
      repeat_requests: repeatCalls,
      production_writes: 0,
      stock_payload_fields: 0,
      ...(revalidation ? { revalidation } : {}),
    };
    await durable(resolve(out, "verification.json"), evidence);
    const receipt = {
      state: "SUCCEEDED",
      store_id: input.store.id,
      local_product_id: localId,
      ...(input.type === "simple"
        ? { variant_id: input.variants[0].id }
        : {
            variants: children.map((c) => ({
              variant_id: c.variant_id,
              local_variation_id: c.id,
            })),
          }),
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
  const [claimFile, runtimeDir, outputDir, previousDir, revalidationFile] =
    process.argv.slice(2);
  assert(
    claimFile && runtimeDir && outputDir,
    "Usage: staging-bridge.mjs CLAIM_JSON RUNTIME_DIR OUTPUT_DIR [PREVIOUS_VERIFIED_DIR] [REVALIDATION_FILE]",
  );
  const claim = JSON.parse(await readFile(resolve(claimFile), "utf8"));
  console.log(
    JSON.stringify(
      await processClaim({
        claim,
        runtimeDir,
        outputDir,
        previousDir,
        revalidationFile,
      }),
      null,
      2,
    ),
  );
}
