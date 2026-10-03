import { hash, compilePlan } from "../../scripts/m9/woo-test/plan.mjs";
import { describe, it, expect } from "vitest";
import {
  sourceImage,
  categoryNodes,
  imageType,
  claimedInput,
} from "../../scripts/m9/woo-test/staging-bridge.mjs";
import { sampleInput } from "../../scripts/m9/woo-test/fixtures.mjs";
function claim() {
  const i = sampleInput();
  const v = { ...i.variants[0], active: true, attributes: {} };
  return {
    id: "11111111-1111-4111-8111-111111111111",
    claim_id: "22222222-2222-4222-8222-222222222222",
    state: "RUNNING",
    packet: {
      version: 1,
      store: i.store,
      product_id: i.product_id,
      revision: 1,
      mode: "create",
      type: "simple",
      content: {
        ...i.content,
        images: [
          { url: "https://vaquerosm.com/wp-content/uploads/test.jpg", alt: "" },
        ],
      },
      category_evidence: { valid: true },
      catalog: { product_id: i.product_id, active: true, variants: [v] },
    },
  };
}
describe("supervised staging bridge", () => {
  it("preserves barcode zeros and excludes production links and inventory", () => {
    const c = claim();
    c.packet.catalog.variants[0].woo_product_id = 19771;
    const p = claimedInput(c);
    expect(p.variants[0].barcode).toBe("000007779");
    expect(p).not.toHaveProperty("target");
    expect(p.variants[0]).not.toHaveProperty("woo_product_id");
    expect(p.variants[0]).not.toHaveProperty("stock_quantity");
  });
  it("requires a claimed job with valid evidence", () => {
    const c = claim();
    c.state = "READY";
    expect(() => claimedInput(c)).toThrow("CLAIM_REQUIRED");
    c.state = "RUNNING";
    c.packet.category_evidence.valid = false;
    expect(() => claimedInput(c)).toThrow("CLAIM_REVIEW_REQUIRED");
  });
  it("refuses a live destination", () => {
    const c = claim();
    c.packet.store.base_url = "https://vaquerosm.com";
    expect(() => claimedInput(c)).toThrow("LOCAL_ONLY");
  });
  it("refuses inactive, variable or duplicate candidates", () => {
    const c = claim();
    c.packet.catalog.variants.push(c.packet.catalog.variants[0]);
    expect(() => claimedInput(c)).toThrow("CLAIM_REVIEW_REQUIRED");
  });
  it("restricts image downloads to allowlisted public paths", () => {
    for (const url of [
      "http://vaquerosm.com/wp-content/uploads/x.jpg",
      "https://evil.test/x.jpg",
      "https://vaquerosm.com@evil.test/wp-content/uploads/x.jpg",
      "https://vaquerosm.com/wp-admin/x",
      "https://vaquerosm.com/wp-content/uploads/../../wp-admin/x",
      "https://vaquerosm.com:444/wp-content/uploads/x.jpg",
    ])
      expect(() => sourceImage(url)).toThrow();
  });
  it("detects actual image bytes instead of trusting the file extension", () => {
    expect(imageType(Buffer.from("RIFF1234WEBP"))).toEqual([
      "image/webp",
      "webp",
    ]);
    expect(() => imageType(Buffer.from("<html>"))).toThrow(
      "UNSUPPORTED_IMAGE_BYTES",
    );
  });
});

function updateCase() {
  const c = claim(),
    input = claimedInput(c),
    plan = compilePlan(input);
  const parent = { id: 18, ...plan.steps[0].payload };
  const baseline = {
    input,
    evidence: {
      parent,
      worker_result: {
        state: "SUCCEEDED",
        plan_hash: hash(plan),
        steps: [{ remote_id: 18 }],
      },
    },
  };
  c.packet.version = 2;
  c.packet.mode = "update";
  c.packet.revision = 2;
  c.packet.previous = {
    revision: 1,
    receipt: { local_product_id: 18, evidence_sha256: hash(baseline.evidence) },
  };
  return { c, baseline };
}
it("updates only the previously verified local ID", () => {
  const { c, baseline } = updateCase();
  const input = claimedInput(c, baseline);
  const plan = compilePlan(input);
  expect(input.target.product_id).toBe(18);
  expect(plan.steps.every((s) => s.method === "PUT")).toBe(true);
});
it("rejects changed evidence, input or missing prior verification", () => {
  const { c, baseline } = updateCase();
  expect(() => claimedInput(c)).toThrow("VERIFIED_PREVIOUS_RESULT_REQUIRED");
  baseline.input.variants[0].barcode = "CHANGED";
  expect(() => claimedInput(c, baseline)).toThrow(
    "VERIFIED_PREVIOUS_RESULT_REQUIRED",
  );
  const clean = updateCase();
  clean.baseline.evidence.parent.id = 19771;
  expect(() => claimedInput(clean.c, clean.baseline)).toThrow(
    "VERIFIED_PREVIOUS_RESULT_REQUIRED",
  );
});

function familyClaim() {
  const c = claim();
  c.packet.type = "variable";
  c.packet.version = 3;
  c.packet.fingerprint = "catalog-hash";
  c.packet.source_fingerprint = "source-hash";
  c.packet.family_evidence = {
    catalog_fingerprint: "catalog-hash",
    source_fingerprint: "source-hash",
    evidence_sha256: "a".repeat(64),
  };
  c.packet.parent_attributes = [
    { name: "Color", option: "GUINDA CON AMARILLO", variation: false },
  ];
  c.packet.catalog.variants = sampleInput().variants.map((v) => ({
    ...v,
    active: true,
    attributes: Object.fromEntries(
      v.attributes.map((a) => [a.name.toUpperCase(), a.option]),
    ),
  }));
  return c;
}
it("requires fresh family evidence and preserves descriptive color separately", () => {
  const c = familyClaim();
  const i = claimedInput(c),
    p = compilePlan(i);
  expect(p.steps).toHaveLength(3);
  expect(p.steps[0].payload.attributes).toContainEqual({
    name: "Color",
    visible: true,
    variation: false,
    options: ["GUINDA CON AMARILLO"],
  });
  expect(p.steps[1].payload.attributes).toEqual([
    { name: "Talla", option: "M" },
  ]);
  c.packet.fingerprint = "new-catalog";
  expect(() => claimedInput(c)).toThrow("CLAIM_REVIEW_REQUIRED");
});
it("uses verified child identities for updates and rejects missing mappings", () => {
  const c = familyClaim(),
    input = claimedInput(c),
    plan = compilePlan(input);
  const children = input.variants.map((v, i) => ({
    variant_id: v.id,
    id: 51 + i,
    snapshot: { id: 51 + i, ...plan.steps[i + 1].payload },
  }));
  const parent = { id: 50, ...plan.steps[0].payload, variations: [51, 52] };
  const baseline = {
    input,
    evidence: {
      parent,
      children,
      worker_result: {
        state: "SUCCEEDED",
        plan_hash: hash(plan),
        steps: [{ remote_id: 50 }],
      },
    },
  };
  c.packet.mode = "update";
  c.packet.version = 4;
  c.packet.revision = 2;
  c.packet.previous = {
    revision: 1,
    receipt: {
      local_product_id: 50,
      evidence_sha256: hash(baseline.evidence),
      variants: children.map((v) => ({
        variant_id: v.variant_id,
        local_variation_id: v.id,
      })),
    },
  };
  expect(
    compilePlan(claimedInput(c, baseline)).steps.map((s) => s.path),
  ).toEqual([
    "products/50",
    "products/50/variations/51",
    "products/50/variations/52",
  ]);
  c.packet.previous.receipt.variants.pop();
  expect(() => claimedInput(c, baseline)).toThrow(
    "VERIFIED_PREVIOUS_VARIANT_REQUIRED",
  );
});

it("builds category ancestry without merging names from different branches", () => {
  expect(categoryNodes(["Camisa", "Dama > Camisa", "Dama"])).toEqual([
    { path: "Camisa", name: "Camisa", parent_path: "" },
    { path: "Dama", name: "Dama", parent_path: "" },
    { path: "Dama > Camisa", name: "Camisa", parent_path: "Dama" },
  ]);
  expect(() => categoryNodes(["Dama>Camisa"])).toThrow("INVALID_CATEGORY_PATH");
});
