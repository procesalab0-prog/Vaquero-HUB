import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { stable } from "./woo-test/plan.mjs";
import { categoryPaths } from "./review-web-families.mjs";
import { parseCategoryPaths } from "./review-catalog-categories.mjs";
import { PHOTO_CATEGORY_IDS } from "./catalogo-categorias-capturar.mjs";
export const PHOTO_REFRESH_ID = "d54ce08a-dcd9-4dba-824a-95164888ead7";
const sha = (x) => createHash("sha256").update(x).digest("hex");
const must = (ok, why) => {
  if (!ok) throw Error(why);
};
const same = (a, b) => stable(a) === stable(b);
const sortMappings = (x) => [...x].sort((a, b) => a.id - b.id);
const storage =
  "https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/";
const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// Store API product responses disclose canonical category permalinks, not parent
// IDs. Every ancestor must itself have been observed among the seven authorized
// products; missing ancestors hold the plan instead of querying a wider catalog.
export function photoCategoryNodes(capture) {
  must(
    capture?.protocol === "m9-photo-category-public-capture-1" &&
      capture.complete === true &&
      capture.credentials_sent === false &&
      capture.origin === "https://vaquerosm.com" &&
      capture.writes_performed === 0 &&
      same(
        capture.products.map((x) => x.id).sort((a, b) => a - b),
        PHOTO_CATEGORY_IDS,
      ),
    "COMPLETE_SEVEN_PUBLIC_PRODUCTS_REQUIRED",
  );
  const byId = new Map(),
    byLink = new Map();
  for (const product of capture.products) {
    must(
      product.status === 200 &&
        product.data?.id === product.id &&
        Array.isArray(product.data.categories) &&
        product.data.categories.length > 0 &&
        product.data.categories.length <= 20 &&
        new Set(product.data.categories.map((c) => c.id)).size ===
          product.data.categories.length,
      "PUBLIC_CATEGORY_MEMBERSHIP_INVALID",
    );
    for (const c of product.data.categories) {
      must(
        Number.isSafeInteger(c.id) &&
          c.id > 0 &&
          typeof c.name === "string" &&
          c.name.trim() === c.name &&
          c.name.length > 0 &&
          typeof c.slug === "string" &&
          /^[a-z0-9%_-]+$/.test(c.slug) &&
          typeof c.link === "string",
        "PUBLIC_CATEGORY_TERM_INVALID",
      );
      const u = new URL(c.link);
      must(
        u.origin === "https://vaquerosm.com" &&
          !u.search &&
          !u.hash &&
          !u.username &&
          !u.password &&
          u.pathname.startsWith("/product-category/") &&
          u.pathname.endsWith("/") &&
          u.pathname.split("/").at(-2) === c.slug,
        "PUBLIC_CATEGORY_PERMALINK_INVALID",
      );
      const term = { id: c.id, name: c.name, slug: c.slug, link: c.link };
      must(
        !byId.has(c.id) || same(byId.get(c.id), term),
        "PUBLIC_CATEGORY_TERM_CHANGED_BETWEEN_PRODUCTS",
      );
      must(
        !byLink.has(c.link) || byLink.get(c.link).id === c.id,
        "PUBLIC_CATEGORY_PERMALINK_DUPLICATE",
      );
      byId.set(c.id, term);
      byLink.set(c.link, term);
    }
  }
  const nodes = [...byId.values()].map((c) => {
    const u = new URL(c.link),
      parts = u.pathname.split("/").filter(Boolean);
    let parent = 0;
    if (parts.length > 2) {
      const parentLink = u.origin + "/" + parts.slice(0, -1).join("/") + "/";
      must(byLink.has(parentLink), "PUBLIC_CATEGORY_ANCESTOR_NOT_OBSERVED");
      parent = byLink.get(parentLink).id;
    }
    return { ...c, parent };
  });
  categoryPaths(nodes);
  return nodes.sort((a, b) => a.id - b.id);
}
export function comparePhotoCategoryMembership(
  binding,
  source,
  draft,
  product,
  nodes,
) {
  const canonical = new Map(categoryPaths(nodes).map((c) => [c.id, c.path])),
    ids = product.data.categories.map((c) => c.id).sort((a, b) => a - b);
  const mappings = sortMappings(binding.mappings);
  if (
    !same(
      ids,
      mappings.map((x) => x.id),
    ) ||
    mappings.some((m) => canonical.get(m.id) !== m.path)
  )
    return "PUBLIC_MEMBERSHIP_OR_CANONICAL_PATH_CHANGED";
  if (
    !same(binding.category_paths, draft.content.categories) ||
    !same(draft.content.categories, source.suggested_content.categories)
  )
    return "SAVED_CATEGORY_CONTENT_CHANGED";
  const parsed = draft.content.categories.flatMap((text) => {
    const p = parseCategoryPaths(text, nodes);
    return p.state === "UNIQUE_PATH_PROPOSAL"
      ? p.mappings
      : [{ id: -1, path: "UNPARSEABLE" }];
  });
  if (!same(sortMappings(parsed), mappings))
    return "SAVED_CATEGORY_CANONICAL_MAPPING_CHANGED";
  return null;
}
export function preparePhotoCategoryReview({
  context,
  capture,
  receipt_meta,
  capture_sha256,
  request_id,
  now = new Date(),
}) {
  const nodes = photoCategoryNodes(capture),
    captured = Date.parse(capture.captured_at),
    currentTime = +now;
  must(
    Number.isFinite(captured) &&
      captured <= currentTime + 300000 &&
      captured >= currentTime - 86400000 &&
      Date.parse(capture.started_at) <= captured &&
      capture.products.every(
        (p) =>
          Date.parse(p.observed_at) >= Date.parse(capture.started_at) &&
          Date.parse(p.observed_at) <= captured,
      ),
    "STALE_OR_INVALID_PUBLIC_CAPTURE",
  );
  const r = context.receipt;
  must(
    r?.request_id === PHOTO_REFRESH_ID &&
      r.reversed_at === null &&
      r.packet.protocol === "m9-variant-photo-refresh-1" &&
      r.result.created === 24 &&
      r.result.previous_evidence_revalidated === 25 &&
      context.current.length === 7 &&
      r.after_state.length === 7 &&
      r.before_state.length === 7 &&
      receipt_meta.exact_copy_evidence_hashes === 49 &&
      /^[a-f0-9]{64}$/.test(receipt_meta.receipt_sha256) &&
      /^[a-f0-9]{64}$/.test(capture_sha256) &&
      /^[a-f0-9-]{36}$/.test(request_id),
    "EXACT_APPLIED_PHOTO_REFRESH_REQUIRED",
  );
  const products = new Map(capture.products.map((p) => [p.id, p])),
    rows = [];
  for (const f of context.current) {
    const before = r.before_state.find((x) => x.product_id === f.product_id),
      after = r.after_state.find((x) => x.product_id === f.product_id),
      fp = r.packet.families.find((x) => x.product_id === f.product_id),
      b = f.category_binding,
      reasons = [];
    if (!before || !after || !fp) throw Error("UNKNOWN_PHOTO_CATEGORY_FAMILY");
    if (
      ![
        "product",
        "catalog",
        "source",
        "draft",
        "variants",
        "managed",
        "evidence",
      ].every((k) => same(f[k], after[k]))
    )
      reasons.push("PHOTO_REFRESH_CURRENT_CONTEXT_CHANGED");
    if (
      !same(b, after.category_binding) ||
      b?.invalidation_reason !== "SOURCE_CHANGED" ||
      !b.invalidated_at ||
      before.category_binding?.invalidated_at !== null ||
      !same(
        { ...b, invalidated_at: null, invalidation_reason: null },
        before.category_binding,
      )
    )
      reasons.push("CATEGORY_INVALIDATION_NOT_FROM_THIS_REFRESH");
    const ids = new Set(f.evidence.map((e) => e.variant_id));
    if (
      f.copies.length !== f.evidence.length ||
      f.copies.some((c) => !ids.has(c.variant_id)) ||
      new Set(f.copies.map((c) => c.variant_id)).size !== f.evidence.length
    )
      reasons.push("PHOTO_COPY_COVERAGE_CHANGED");
    for (const c of after.copies)
      if (
        !same(
          c,
          f.copies.find((x) => x.variant_id === c.variant_id),
        )
      )
        reasons.push("PREVIOUS_PHOTO_COPY_CHANGED");
    for (const e of f.evidence) {
      const c = f.copies.find((c) => c.variant_id === e.variant_id);
      const wanted = e.photos.map((p) => ({
        url: `${storage}${f.product_id}/${p.sha256}.${ext[p.mime]}`,
        alt: p.alt,
      }));
      if (
        !c ||
        !same(c.photos, wanted) ||
        e.photos.some(
          (p, i) =>
            !f.objects.some(
              (o) =>
                o.name === wanted[i].url.slice(storage.length) &&
                Number(o.metadata?.size) === p.bytes &&
                o.metadata?.mimetype === p.mime,
            ),
        )
      )
        reasons.push("PHOTO_OBJECT_OR_LINK_CHANGED");
    }
    if (
      f.source.snapshot.source_status !== "publish" ||
      f.source.snapshot.type !== "variable" ||
      f.source.snapshot.woo_product_id !== b.woo_product_id ||
      fp.woo_product_id !== b.woo_product_id
    )
      reasons.push("WOO_PARENT_SOURCE_CHANGED");
    const product = products.get(b.woo_product_id);
    const categoryIssue = product
      ? comparePhotoCategoryMembership(b, f.source, f.draft, product, nodes)
      : "PUBLIC_PRODUCT_ABSENT";
    if (categoryIssue) reasons.push(categoryIssue);
    rows.push({
      product_id: f.product_id,
      woo_product_id: b.woo_product_id,
      state: reasons.length ? "HELD" : "TECHNICAL_REVIEW_READY",
      reasons: [...new Set(reasons)],
      mappings: b.mappings,
    });
  }
  const payload = {
    protocol: "m9-photo-category-review-1",
    request_id,
    refresh_id: PHOTO_REFRESH_ID,
    expected_receipt_sha256: receipt_meta.receipt_sha256,
    capture_sha256,
    capture,
    expected_current: context.current,
    mappings: rows.map((r) => ({
      product_id: r.product_id,
      woo_product_id: r.woo_product_id,
      mappings: r.mappings,
    })),
  };
  return {
    protocol: "m9-photo-category-plan-1",
    summary: {
      families: 7,
      ready: rows.filter((r) => r.state === "TECHNICAL_REVIEW_READY").length,
      held: rows.filter((r) => r.state === "HELD").length,
      public_capture_at: capture.captured_at,
      photo_evidence: 49,
      photo_copies: 49,
      woo_writes: 0,
      inventory_writes: 0,
    },
    rows,
    payload: rows.every((r) => r.state === "TECHNICAL_REVIEW_READY")
      ? payload
      : null,
    send_allowed: false,
    writes_performed: 0,
  };
}
export async function writePhotoCategoryReview(configPath, out) {
  const config = JSON.parse(await readFile(configPath, "utf8")),
    inputs = {};
  for (const name of ["context", "capture", "receipt_meta"]) {
    const item = config.inputs[name],
      bytes = await readFile(resolve(dirname(configPath), item.path));
    must(sha(bytes) === item.sha256, "PHOTO_CATEGORY_INPUT_SHA_CHANGED");
    inputs[name] = JSON.parse(bytes);
  }
  must(
    inputs.capture.products.every(
      (p) =>
        typeof p.raw_json === "string" &&
        sha(p.raw_json) === p.raw_sha256 &&
        same(JSON.parse(p.raw_json), p.data),
    ),
    "PUBLIC_RAW_CAPTURE_BYTES_CHANGED",
  );
  const plan = preparePhotoCategoryReview({
    ...inputs,
    capture_sha256: config.inputs.capture.sha256,
    request_id: config.request_id,
    now: config.evaluated_at ? new Date(config.evaluated_at) : new Date(),
  });
  await mkdir(out, { recursive: false, mode: 0o700 });
  for (const [name, value] of Object.entries({
    "plan.json": plan,
    "payload.json": plan.payload,
    "summary.json": plan.summary,
  }))
    await writeFile(resolve(out, name), JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  return plan.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4)
    throw Error("USAGE: CONFIG NEW_PRIVATE_OUTPUT");
  console.log(
    JSON.stringify(
      await writePhotoCategoryReview(
        resolve(process.argv[2]),
        resolve(process.argv[3]),
      ),
    ),
  );
}
