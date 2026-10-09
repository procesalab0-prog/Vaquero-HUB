import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownerQuestions } from "../../scripts/m9/prepare-owner-questions.mjs";
import { coverageReview } from "../../scripts/m9/prepare-coverage-review.mjs";
import {
  ownerLoadReview,
  prepareOwnerLoadReview,
} from "../../scripts/m9/prepare-owner-load-review.mjs";
import { prepareSicarOnly } from "../../scripts/m9/prepare-sicar-only.mjs";
import { planSicarOnly } from "../../scripts/m9/plan-sicar-only.mjs";
import { stable } from "../../scripts/m9/woo-test/plan.mjs";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const actor = "11111111-1111-4111-8111-111111111111";
function fixture(descriptions = ["MODELOT.S", "MODELOT.M"]) {
  const rows = descriptions.map((description, i) => ({
    barcode: "0000" + (i + 1),
    description,
    classification: "SICAR_ONLY",
    issues: [],
    commercial_checks: [],
    candidate_product_ids: [],
    fields: {
      "clave1 *": "0000" + (i + 1),
      "descripción *": description,
      departamento: "NIÑO",
      categoria: "CAMISAS",
      precio1: "740",
      "(s/n) mostrar en ventas": "s",
    },
  }));
  const inputs = {
    rows,
    applied: structuredClone(rows),
    snapshot: {
      project_id: "zsezjtswqeijboezvado",
      rows: [],
      products: [],
      inventory_balances: 0,
      inventory_movements: 0,
    },
    taxonomy: { paths: [] },
    holds: [],
    rowsCutSha: sha(JSON.stringify(rows)),
  };
  const coverage = coverageReview(
    rows,
    inputs.applied,
    inputs.snapshot,
    inputs.taxonomy,
  );
  const pending = rows.map((r) => ({
    barcode: r.barcode,
    description: r.description,
    department: r.fields.departamento,
    section: r.fields.categoria,
    retail_source: r.fields.precio1,
    price_cents: 74000,
    classification: r.classification,
    reasons: [],
    candidate_woo_ids: [],
  }));
  // Include explicit families even when they need extra technical review, to
  // exercise that a positive owner answer cannot erase those issues.
  const families = coverage.cases.map((c) => ({ ...c, issues: [] }));
  const packet = ownerQuestions(families, { cases: [] }, pending, {
    cut_sha: inputs.rowsCutSha,
    expected_count: rows.length,
  });
  const exported = {
    version: "m9-owner-answer-export-1",
    cut_sha: packet.cut_sha,
    questions: packet.questions.map((q) => ({
      question_id: q.question_id,
      evidence: q,
      batch: 1,
      answers: [],
    })),
    approved_for_import: 0,
    send_allowed: false,
  };
  return { packet, exported, inputs };
}
function answer(f, choice = "SAME_MODEL", extra = {}, index = 0) {
  const item = f.exported.questions[index];
  item.answers.push({
    actor,
    choice,
    note: "",
    commercial_name: "",
    created_at: "2026-10-07T22:00:00Z",
    revision: item.answers.length + 1,
    ...extra,
  });
}
const run = (f) => ownerLoadReview(f.packet, f.exported, f.inputs);
function reseal(f) {
  const body = { ...f.packet };
  delete body.packet_sha256;
  f.packet.packet_sha256 = sha(stable(body));
  for (const q of f.exported.questions)
    q.evidence = structuredClone(
      f.packet.questions.find((p) => p.question_id === q.question_id),
    );
}
describe("Owner confirmations become pending technical work, never imports", () => {
  it("revalidates all reserved questions without inventing responses or releasing them", () => {
    const f = fixture(["AT.S", "AT.M", "BT.L"]);
    f.exported.questions = f.exported.questions.slice(0, 1);
    const r = run(f);
    expect(r.summary.bank_questions_revalidated).toBe(2);
    expect(r.tasks).toHaveLength(1);
    expect(r.pending_decisions).toEqual([]);
    expect(r.summary.actual_answers).toBe(0);
    expect(r.tasks[0].status).toBe("AWAITING_OWNER");
  });
  it("keeps a confirmed family's literal codes and sizes, but the old planner rejects its pending draft", () => {
    const f = fixture();
    answer(f);
    const r = run(f),
      d = r.pending_decisions[0];
    expect(d.members).toEqual([
      { barcode: "00001", attributes: { TALLA: "S" } },
      { barcode: "00002", attributes: { TALLA: "M" } },
    ]);
    expect(d.status).toBe("pending");
    expect(d.reviewer).toBe("");
    const p = planSicarOnly(
      prepareSicarOnly(f.inputs.rows),
      r.pending_decisions,
    );
    expect(p.families).toEqual([]);
    expect(p.errors[0].reasons).toContain("REVIEW_REQUIRED");
    expect(r.import_allowed).toBe(false);
    expect(r.send_allowed).toBe(false);
    expect(r.inventory_included).toBe(false);
  });
  it.each(["CORRECTION", "UNSURE"])(
    "does not draft an import for %s",
    (choice) => {
      const f = fixture();
      answer(f, choice, {
        note: choice === "CORRECTION" ? "Separar colores" : "",
      });
      expect(run(f).pending_decisions).toEqual([]);
    },
  );
  it("uses the latest answer and binds the full history", () => {
    const f = fixture();
    answer(f);
    const old = run(f).tasks[0].answer_binding_sha256;
    answer(f, "CORRECTION", { note: "Son dos modelos" });
    const r = run(f);
    expect(r.pending_decisions).toEqual([]);
    expect(r.tasks[0].status).toBe("REQUIRES_SOURCE_CORRECTION");
    expect(r.tasks[0].answer_binding_sha256).not.toBe(old);
  });
  it("blocks a positive answer with a note for technical interpretation", () => {
    const f = fixture();
    answer(f, "SAME_MODEL", { note: "La M podría ser juvenil" });
    expect(run(f).tasks[0].issues).toContain("OWNER_NOTE_REVIEW");
    expect(run(f).pending_decisions).toEqual([]);
  });
  it("does not overwrite a destination product with the owner's commercial name", () => {
    const f = fixture();
    answer(f, "SAME_MODEL", { commercial_name: "Camisa Niño" });
    f.inputs.snapshot.products = [{ id: actor, name: " CAMISA NIÑO " }];
    expect(run(f).tasks[0].issues).toContain("DESTINATION_NAME_REVIEW");
    expect(run(f).pending_decisions).toEqual([]);
  });
  it("reserves matching commercial names across two confirmed families", () => {
    const f = fixture(["AT.S", "BT.M"]);
    answer(f, "SAME_MODEL", { commercial_name: "Modelo Único" }, 0);
    answer(f, "SAME_MODEL", { commercial_name: "MODELO ÚNICO" }, 1);
    expect(
      run(f).tasks.every((t) =>
        t.issues.includes("ANSWER_NAME_COLLISION_REVIEW"),
      ),
    ).toBe(true);
    expect(run(f).pending_decisions).toEqual([]);
  });
  it("retains manual holds instead of treating confirmation as their release", () => {
    const f = fixture();
    f.inputs.holds = [
      {
        barcode: "00001",
        description: "MODELOT.S",
        reason: "Agrupación pendiente",
      },
    ];
    answer(f);
    expect(run(f).tasks[0].issues).toContain("EXISTING_MANUAL_HOLD");
    expect(run(f).pending_decisions).toEqual([]);
  });
  it("does not turn a combined size and length into one size automatically", () => {
    const f = fixture(["PANTT.32X34"]);
    answer(f);
    expect(run(f).tasks[0].issues).toContain("ATTRIBUTE_DIMENSIONS_REVIEW");
    expect(run(f).pending_decisions).toEqual([]);
  });
  it("blocks a commercial name too long for the existing importer", () => {
    const f = fixture();
    answer(f, "SAME_MODEL", { commercial_name: "x".repeat(161) });
    expect(run(f).tasks[0].issues).toContain("PRODUCT_NAME_LIMIT");
  });
  it("rejects a changed source cut before using answers", () => {
    const f = fixture();
    f.inputs.rowsCutSha = "0".repeat(64);
    expect(() => run(f)).toThrow("OWNER_SOURCE_CUT_CHANGED");
  });
  it("rejects stale source prices against the applied reference", () => {
    const f = fixture();
    f.inputs.rows[0].fields.precio1 = "741";
    expect(() => run(f)).toThrow("APPLIED_REFERENCE_NOT_SAME_SICAR_CUT");
  });
  it("rejects a changed question member even after a newly computed packet hash", () => {
    const f = fixture();
    f.packet.questions[0].members[0].source_evidence.price_cents = 1;
    reseal(f);
    expect(() => run(f)).toThrow("QUESTION_MEMBER_CHANGED");
  });
  it("rejects a partial family instead of preparing only selected sizes", () => {
    const f = fixture();
    f.packet.questions[0].members.pop();
    reseal(f);
    expect(() => run(f)).toThrow("QUESTION_FAMILY_CHANGED");
  });
  it("rejects overlapping or duplicate reserved questions", () => {
    const f = fixture();
    f.packet.questions.push(structuredClone(f.packet.questions[0]));
    reseal(f);
    expect(() => run(f)).toThrow("QUESTION_FAMILY_CHANGED");
  });
  it("rejects a current source family with an extra size not in the question", () => {
    const f = fixture();
    const r = {
      ...structuredClone(f.inputs.rows[0]),
      barcode: "00003",
      description: "MODELOT.L",
    };
    r.fields["clave1 *"] = "00003";
    r.fields["descripción *"] = r.description;
    f.inputs.rows.push(r);
    f.inputs.applied.push(structuredClone(r));
    expect(() => run(f)).toThrow("QUESTION_FAMILY_CHANGED");
  });
  it.each(["inventory_balances", "inventory_movements"])(
    "refuses a destination with %s",
    (key) => {
      const f = fixture();
      f.inputs.snapshot[key] = 1;
      expect(() => run(f)).toThrow("INVENTORY_MUST_REMAIN_EMPTY");
    },
  );
  it("refuses production snapshots", () => {
    const f = fixture();
    f.inputs.snapshot.project_id = "drubkjlmfbdeglucakmg";
    expect(() => run(f)).toThrow();
  });
  it("rejects an already staged barcode rather than duplicating it", () => {
    const f = fixture(),
      source = f.inputs.rows[0],
      current = {
        barcode: source.barcode,
        description: source.description,
        department: "NIÑO",
        section: "CAMISAS",
        price_cents: 74000,
        cost_cents: null,
        attributes: {},
        woo_product_id: null,
        woo_variation_id: null,
      };
    f.inputs.snapshot.products = [{ id: actor, name: "Otro" }];
    f.inputs.snapshot.rows = [
      { variant_id: actor, product_id: actor, stored: current, current },
    ];
    expect(() => run(f)).toThrow("SICAR_ONLY_ALREADY_STAGED_REQUIRES_REVIEW");
  });
  it("writes reproducible artifacts and refuses changed inputs before creating output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m9-owner-plan-"));
    try {
      const f = fixture();
      f.inputs.rowsCutSha = sha(JSON.stringify(f.inputs.rows));
      f.packet.cut_sha = f.inputs.rowsCutSha;
      f.exported.cut_sha = f.packet.cut_sha;
      reseal(f);
      const values = { packet: f.packet, answers: f.exported, ...f.inputs };
      const config = { inputs: {} };
      for (const k of [
        "packet",
        "answers",
        "rows",
        "applied",
        "snapshot",
        "taxonomy",
        "holds",
      ]) {
        const bytes = JSON.stringify(values[k]);
        await writeFile(join(dir, k + ".json"), bytes);
        config.inputs[k] = { path: k + ".json", sha256: sha(bytes) };
      }
      const path = join(dir, "config.json");
      await writeFile(path, JSON.stringify(config));
      await prepareOwnerLoadReview(path, join(dir, "a"));
      await prepareOwnerLoadReview(path, join(dir, "b"));
      expect(
        await readFile(join(dir, "a", "revision-tecnica.json"), "utf8"),
      ).toBe(await readFile(join(dir, "b", "revision-tecnica.json"), "utf8"));
      await writeFile(join(dir, "answers.json"), "{}");
      await expect(
        prepareOwnerLoadReview(path, join(dir, "bad")),
      ).rejects.toThrow("INPUT_HASH_CHANGED");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
