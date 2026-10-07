import { it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  reviewBacklog,
  collectReviewAnswers,
  backlogHtml,
  prepareBacklog,
  reviewTasks,
} from "../../scripts/m9/prepare-review-backlog.mjs";
import { saveReviewAnswers } from "../../scripts/m9/collect-review-answers.mjs";
const sha = (v) => createHash("sha256").update(v).digest("hex");
function fixture() {
  const row = (
    barcode,
    description,
    classification = "CONFLICT",
    ids = [10],
  ) => ({
    barcode,
    description,
    classification,
    candidate_product_ids: ids,
    attributes: [],
    issues: [],
    commercial_checks: [],
    reasons: [],
    fields: {
      "clave1 *": barcode,
      "descripción *": description,
      departamento: "CABALLERO",
      categoria: "CAMISAS",
      precio1: "740",
      "(s/n) mostrar en ventas": "s",
    },
  });
  return {
    rows: [
      row("0001", "ABT.S", "SICAR_ONLY", []),
      row("0002", "ABT.M", "SICAR_ONLY", []),
      row("3", "CD27", "CONFLICT", [10, 20]),
      row("4", "EF28", "SPECIAL_SUFFIX", [20, 30]),
      row("5", "UNSPLIT42", "SICAR_ONLY", []),
    ],
    snapshot: {
      project_id: "zsezjtswqeijboezvado",
      rows: [],
      inventory_balances: 0,
      inventory_movements: 0,
    },
    woo: {
      pagination_complete: true,
      products: [10, 20, 30].map((id) => ({
        id,
        name: "Camisa " + id,
        status: id === 30 ? "private" : "publish",
        short_description: "BASE" + id,
        variations: [],
        permalink: "https://vaquerosm.com/product/" + id,
      })),
    },
    exclusions: [],
  };
}
const packet = (f) => reviewBacklog(f.rows, f.snapshot, f.woo, f.exclusions);
const answer = (p) => ({
  case_id: p.cases[0].case_id,
  packet_sha256: p.packet_sha256,
  evidence_sha256: p.cases[0].evidence_sha256,
  reviewer: "Dueño",
  answer: "Son modelos distintos; revisar sus tallas.",
});

it("partitions all pending, preserves barcodes and groups transitive candidates without approving a family", () => {
  const f = fixture(),
    before = structuredClone(f),
    p = packet(f);
  expect(f).toEqual(before);
  expect(p.summary).toMatchObject({
    source_rows: 5,
    staged_rows: 0,
    pending_rows: 5,
    cases: 3,
    sicar_only_rows: 3,
    approved_for_import: 0,
  });
  const woo = p.cases.find((c) => c.kind === "WOO_COMPONENT");
  expect(woo.candidates.map((c) => c.id)).toEqual([10, 20, 30]);
  expect(woo.candidates[2].status).toBe("private");
  expect(
    p.cases.flatMap((c) => c.members.map((r) => r.barcode)).sort(),
  ).toEqual(["0001", "0002", "3", "4", "5"]);
  expect(p.cases.every((c) => !c.import_allowed && !c.send_allowed)).toBe(true);
  expect(p.cases.find((c) => c.kind === "SICAR_UNSPLIT").title).toBe(
    "UNSPLIT42",
  );
});

it("keeps classification boundaries and explicit related proposals without joining by department", () => {
  const f = fixture();
  f.rows[1].fields.departamento = "NIÑO";
  const p = packet(f),
    cases = p.cases.filter((c) => c.kind === "SICAR_EXPLICIT");
  expect(cases).toHaveLength(2);
  expect(
    cases.every(
      (c) =>
        c.related.length === 1 &&
        c.extra.includes("BASE_IN_MULTIPLE_CLASSIFICATIONS"),
    ),
  ).toBe(true);
});

it("excludes already staged exact rows without losing the rest of their proposed review group", () => {
  const f = fixture();
  const current = {
    barcode: "0001",
    description: "ABT.S",
    department: "CABALLERO",
    section: "CAMISAS",
    price_cents: 74000,
    cost_cents: null,
    attributes: {},
    woo_product_id: null,
    woo_variation_id: null,
    product_name: "AB",
  };
  f.snapshot.rows.push({
    variant_id: "v1",
    product_id: "p1",
    current,
    stored: structuredClone(current),
  });
  const p = packet(f);
  expect(p.summary).toMatchObject({ staged_rows: 1, pending_rows: 4 });
  expect(p.cases.flatMap((c) => c.members.map((r) => r.barcode))).not.toContain(
    "0001",
  );
  expect(
    p.cases
      .find((c) => c.kind === "SICAR_EXPLICIT")
      .members.map((r) => r.barcode),
  ).toEqual(["0002"]);
});

it("invalidates old answers after a new source price even when membership and case ID are unchanged", () => {
  const f = fixture(),
    old = packet(f),
    a = answer(old);
  f.rows.find(
    (r) => r.barcode === old.cases[0].members[0].barcode,
  ).fields.precio1 = "750";
  const fresh = packet(f);
  expect(fresh.cases.map((c) => c.case_id)).toEqual(
    old.cases.map((c) => c.case_id),
  );
  expect(() => collectReviewAnswers(fresh, [a])).toThrow(
    "STALE_ANSWER_EVIDENCE",
  );
});

it("explains technical and owner review tasks without treating non-public products or exhibition as sale approval", () => {
  const f = fixture();
  f.rows[2].classification = "DUPLICATE_WOO_BASE";
  f.exclusions.push({
    barcode: "3",
    description: "CD27",
    reasons: ["FAMILIA_SECCIONES_DISTINTAS", "PRECIO_PUBLICO_NO_VALIDO"],
  });
  f.rows[3].display_only = true;
  const c = packet(f).cases.find((c) => c.kind === "WOO_COMPONENT"),
    tasks = reviewTasks(c).join(" ");
  expect(tasks).toContain("no fusionarlos por nombre");
  expect(tasks).toContain("Renovar el estado");
  expect(tasks).toContain("departamento y sección");
  expect(tasks).toContain("precio público");
  expect(tasks).toContain("bloqueada la compra");
  expect(c.import_allowed).toBe(false);
});

it("rejects duplicate source IDs, changed literals, unknown candidates and stale exclusion descriptions", () => {
  for (const mutate of [
    (f) => f.rows.push(f.rows[0]),
    (f) => (f.rows[0].fields["clave1 *"] = "1"),
    (f) => (f.rows[2].candidate_product_ids = [999]),
    (f) => f.woo.products.push(f.woo.products[0]),
    (f) =>
      f.exclusions.push({ barcode: "3", description: "changed", reasons: [] }),
  ]) {
    const f = fixture();
    mutate(f);
    expect(() => packet(f)).toThrow();
  }
});

it("reserves altered destinations, invalid staging and any inventory", () => {
  const f = fixture();
  f.snapshot.inventory_movements = 1;
  expect(() => packet(f)).toThrow("INVENTORY");
  f.snapshot.inventory_movements = 0;
  f.snapshot.project_id = "production";
  expect(() => packet(f)).toThrow("STAGING");
  f.snapshot.project_id = "zsezjtswqeijboezvado";
  f.snapshot.rows.push({
    variant_id: "v",
    product_id: "p",
    current: { barcode: "3", cost_cents: null },
    stored: {},
  });
  expect(() => packet(f)).toThrow("STAGED_CATALOG_CHANGED");
});

it("records testimony only, rejecting stale, duplicate, unknown, partial and approval-shaped answers", () => {
  const p = packet(fixture()),
    a = answer(p);
  expect(collectReviewAnswers(p, [a])[0]).toMatchObject({
    import_allowed: false,
    send_allowed: false,
    status: "ANSWER_RECORDED_REQUIRES_TECHNICAL_REVIEW",
  });
  for (const input of [
    [a, a],
    [{ ...a, case_id: "unknown" }],
    [{ ...a, packet_sha256: "old" }],
    [{ ...a, evidence_sha256: "old" }],
    [{ ...a, reviewer: "" }],
    [{ ...a, answer: "" }],
    [{ ...a, status: "approved" }],
  ])
    expect(() => collectReviewAnswers(p, input)).toThrow();
  p.cases[0].members[0].public_price = "0";
  expect(() => collectReviewAnswers(p, [a])).toThrow("PACKET_CHANGED");
});

it("does not emit executable source text, untrusted URLs, stock or assumed barcode suffixes", () => {
  const f = fixture();
  f.woo.products[0].name = "</script><script>alert(1)</script>";
  f.woo.products[0].permalink = "javascript:alert(1)";
  f.rows[0].fields.existencia = "PRIVATE_STOCK_VALUE";
  const p = packet(f),
    html = backlogHtml(p);
  expect(html).not.toContain(f.woo.products[0].name);
  expect(html).not.toContain("PRIVATE_STOCK_VALUE");
  expect(
    p.cases.flatMap((c) => c.candidates).find((c) => c.id === 10).url,
  ).toBe(null);
  expect(JSON.stringify(p)).not.toContain('"existencia"');
});

it("reproduces all packet files and validates saved answers; rejects tampered inputs and existing output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "m9-backlog-"));
  try {
    const f = fixture(),
      inputs = {};
    for (const [key, value] of Object.entries(f)) {
      const bytes = JSON.stringify(value);
      await writeFile(join(dir, key + ".json"), bytes);
      inputs[key] = { path: key + ".json", sha256: sha(bytes) };
    }
    const config = join(dir, "config.json");
    await writeFile(config, JSON.stringify({ inputs }));
    await prepareBacklog(config, join(dir, "one"));
    await prepareBacklog(config, join(dir, "two"));
    for (const name of await readdir(join(dir, "one")))
      expect(await readFile(join(dir, "one", name))).toEqual(
        await readFile(join(dir, "two", name)),
      );
    await expect(prepareBacklog(config, join(dir, "one"))).rejects.toThrow();
    const p = JSON.parse(await readFile(join(dir, "one", "expedientes.json")));
    await writeFile(join(dir, "answers.json"), JSON.stringify([answer(p)]));
    const result = await saveReviewAnswers(
      join(dir, "one", "expedientes.json"),
      join(dir, "answers.json"),
      join(dir, "recorded"),
    );
    expect(result).toMatchObject({
      recorded_answers: 1,
      pending_cases: 2,
      approved_for_import: 0,
    });
    await writeFile(join(dir, "rows.json"), "[]");
    await expect(prepareBacklog(config, join(dir, "bad"))).rejects.toThrow(
      "INPUT_HASH_CHANGED",
    );
    await expect(readdir(join(dir, "bad"))).rejects.toThrow();
    await writeFile(join(dir, "one", "expedientes.json"), "{}");
    await expect(
      saveReviewAnswers(
        join(dir, "one", "expedientes.json"),
        join(dir, "answers.json"),
        join(dir, "bad-answers"),
      ),
    ).rejects.toThrow("PACKET_HASH_CHANGED");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
