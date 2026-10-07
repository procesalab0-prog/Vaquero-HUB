import { describe, it, expect } from "vitest";
import { ownerQuestions } from "../../scripts/m9/prepare-owner-questions.mjs";
import { reviewOwnerAnswers } from "../../scripts/m9/review-owner-answers.mjs";

function fixture() {
  const source = {
    barcode: "00001",
    description: "MODELOT.S",
    department: "NIÑO",
    section: "CAMISAS",
    retail_source: "740",
    price_cents: 74000,
    classification: "SICAR_ONLY",
    reasons: [],
    candidate_woo_ids: [],
  };
  const family = {
    case_id: "a".repeat(64),
    kind: "EXPLICIT_T_PROPOSAL",
    product_name_proposed: "MODELO",
    department: "NIÑO",
    section: "CAMISAS",
    issues: [],
    evidence_sha256: "b".repeat(64),
    members: [{ ...source, proposed: { base: "MODELO", suffix: "S" } }],
  };
  return {
    source,
    family,
    priority: { cases: [{ case_id: family.case_id }] },
    cut: { cut_sha: "c".repeat(64), expected_count: 1 },
  };
}
describe("Owner questions bound to literal source evidence", () => {
  it("keeps leading zeroes and the complete model scope without approval", () => {
    const f = fixture(),
      result = ownerQuestions([f.family], f.priority, [f.source], f.cut);
    expect(result.questions[0].members[0].barcode).toBe("00001");
    expect(result.questions[0].members[0].source_evidence).toEqual(f.source);
    expect(result.summary.covered_rows).toBe(1);
    expect(result.summary.approved_for_import).toBe(0);
    expect(result.import_allowed).toBe(false);
  });
  it("does not turn unsplit descriptions or extra issues into owner confirmations", () => {
    const f = fixture();
    f.priority.cases = [];
    expect(
      ownerQuestions(
        [{ ...f.family, kind: "UNSPLIT_RECORD" }],
        f.priority,
        [f.source],
        f.cut,
      ).questions,
    ).toHaveLength(0);
    expect(
      ownerQuestions(
        [{ ...f.family, issues: ["CONFLICT"] }],
        f.priority,
        [f.source],
        f.cut,
      ).questions,
    ).toHaveLength(0);
  });
  it("rejects stale source price or description", () => {
    const f = fixture();
    expect(() =>
      ownerQuestions(
        [f.family],
        f.priority,
        [{ ...f.source, retail_source: "741" }],
        f.cut,
      ),
    ).toThrow("QUESTION_SOURCE_CHANGED");
    expect(() =>
      ownerQuestions(
        [f.family],
        f.priority,
        [{ ...f.source, description: "OTHER" }],
        f.cut,
      ),
    ).toThrow("QUESTION_SOURCE_CHANGED");
  });
  it("requires the literal T. delimiter, not suffix guessing", () => {
    const f = fixture();
    f.source.description = "MODELOS";
    f.family.members[0].description = "MODELOS";
    expect(() =>
      ownerQuestions([f.family], f.priority, [f.source], f.cut),
    ).toThrow("QUESTION_SOURCE_CHANGED");
  });
  it("rejects overlapping questions and repeated source codes", () => {
    const f = fixture();
    expect(() =>
      ownerQuestions(
        [f.family, { ...f.family, case_id: "d".repeat(64) }],
        f.priority,
        [f.source],
        f.cut,
      ),
    ).toThrow("QUESTION_SOURCE_CHANGED");
    expect(() =>
      ownerQuestions([f.family], f.priority, [f.source, f.source], {
        ...f.cut,
        expected_count: 2,
      }),
    ).toThrow("PENDING_PARTITION_CHANGED");
  });
  it("rejects missing priority cases", () => {
    const f = fixture();
    expect(() => ownerQuestions([], f.priority, [f.source], f.cut)).toThrow(
      "PRIORITY_CASES_CHANGED",
    );
  });
  it("keeps the previously consulted Wrangler case pending without inventing an answer", () => {
    const f = fixture();
    f.priority.cases = [];
    const base = "CAWRNIÑO3587",
      source = { ...f.source, description: `${base}T.S` };
    const held = {
      ...f.family,
      product_name_proposed: base,
      issues: ["EXISTING_MANUAL_HOLD"],
      members: [{ ...source, proposed: { base, suffix: "S" } }],
    };
    const result = ownerQuestions([held], f.priority, [source], f.cut);
    expect(result.questions[0].previously_consulted).toBe(true);
    expect(result.questions[0]).not.toHaveProperty("answer");
    expect(result.summary.approved_for_import).toBe(0);
  });
  it("binds the packet to all evidence and reproduces exactly", () => {
    const f = fixture(),
      a = ownerQuestions([f.family], f.priority, [f.source], f.cut);
    expect(ownerQuestions([f.family], f.priority, [f.source], f.cut)).toEqual(
      a,
    );
    const changed = ownerQuestions(
      [f.family],
      f.priority,
      [{ ...f.source, reasons: ["REVIEW"] }],
      f.cut,
    );
    expect(changed.packet_sha256).not.toBe(a.packet_sha256);
  });
  it("does not hide the remaining technical work or consider it approved", () => {
    const f = fixture();
    const result = ownerQuestions(
      [f.family],
      f.priority,
      [f.source, { ...f.source, barcode: "00002" }],
      { ...f.cut, expected_count: 2 },
    );
    expect(result.summary.technical_rows).toBe(1);
    expect(result.summary.covered_rows + result.summary.technical_rows).toBe(2);
  });
});

describe("Recorded answers require a separate technical plan", () => {
  function answerFixture() {
    const f = fixture(),
      packet = ownerQuestions([f.family], f.priority, [f.source], f.cut);
    const answer = {
      revision: 1,
      actor: "11111111-1111-4111-8111-111111111111",
      choice: "SAME_MODEL",
      note: "",
      commercial_name: "Camisa",
      created_at: "2026-10-07T18:00:00Z",
    };
    const exported = {
      version: "m9-owner-answer-export-1",
      cut_sha: packet.cut_sha,
      approved_for_import: 0,
      send_allowed: false,
      questions: [
        {
          question_id: f.family.case_id,
          evidence: packet.questions[0],
          batch: 1,
          answers: [answer],
        },
      ],
    };
    return { packet, exported };
  }
  it("records a yes as testimony, never approval", () => {
    const f = answerFixture(),
      reviewed = reviewOwnerAnswers(f.packet, f.exported);
    expect(reviewed.cases[0].status).toBe("REQUIRES_TECHNICAL_PLAN");
    expect(reviewed.cases[0].import_allowed).toBe(false);
    expect(reviewed.summary.approved_for_import).toBe(0);
  });
  it("rejects a new cut, modified evidence and duplicate question", () => {
    const f = answerFixture();
    expect(() =>
      reviewOwnerAnswers(f.packet, { ...f.exported, cut_sha: "d".repeat(64) }),
    ).toThrow("INVALID_ANSWER_EXPORT");
    expect(() =>
      reviewOwnerAnswers(f.packet, {
        ...f.exported,
        questions: [
          {
            ...f.exported.questions[0],
            evidence: { ...f.packet.questions[0], title: "OTHER" },
          },
        ],
      }),
    ).toThrow("ANSWER_EVIDENCE_CHANGED");
    expect(() =>
      reviewOwnerAnswers(f.packet, {
        ...f.exported,
        questions: [f.exported.questions[0], f.exported.questions[0]],
      }),
    ).toThrow("ANSWER_EVIDENCE_CHANGED");
  });
  it("requires a complete ordered history and rejects approval fields", () => {
    const f = answerFixture(),
      question = f.exported.questions[0];
    expect(() =>
      reviewOwnerAnswers(f.packet, {
        ...f.exported,
        questions: [
          { ...question, answers: [{ ...question.answers[0], revision: 2 }] },
        ],
      }),
    ).toThrow("INVALID_ANSWER_HISTORY");
    expect(() =>
      reviewOwnerAnswers(f.packet, {
        ...f.exported,
        questions: [
          {
            ...question,
            answers: [{ ...question.answers[0], approved: true }],
          },
        ],
      }),
    ).toThrow("INVALID_ANSWER_HISTORY");
  });
  it("keeps unsure, corrections and no-answer separate", () => {
    const f = answerFixture(),
      question = f.exported.questions[0];
    const withAnswers = (answers: unknown[]) =>
      reviewOwnerAnswers(f.packet, {
        ...f.exported,
        questions: [{ ...question, answers }],
      }).cases[0].status;
    expect(withAnswers([])).toBe("AWAITING_OWNER");
    expect(withAnswers([{ ...question.answers[0], choice: "UNSURE" }])).toBe(
      "AWAITING_CONSULTATION",
    );
    expect(
      withAnswers([
        {
          ...question.answers[0],
          choice: "CORRECTION",
          note: "Son dos modelos",
        },
      ]),
    ).toBe("REQUIRES_SOURCE_CORRECTION");
  });
});
