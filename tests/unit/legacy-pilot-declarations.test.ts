import { describe, expect, it } from "vitest";
import {
  pilotCountDeclarations,
  pilotEvidenceComplete,
  type PilotCountKey,
  type PilotFieldView,
} from "../../lib/legacy-pilot-declarations";
import { legacyPilotFailure } from "../../lib/legacy-pilot";
const values = {
  physical_qty: null,
  sold_waiting_qty: null,
  separated_qty: null,
};
const fields = () =>
  Object.fromEntries(
    Object.keys(values).map((key) => [key, { declared: null, source: "" }]),
  ) as Record<PilotCountKey, { declared: string | null; source: string }>;
describe("declarations in the existing pilot sheet", () => {
  it("keeps all unknown fields without declarations or inferred zeros", () => {
    expect(pilotCountDeclarations(values, fields())).toEqual({});
    expect(pilotEvidenceComplete(undefined)).toBe(false);
  });
  it("requires explicit confirmation and source for zero as well as positive numbers", () => {
    for (const qty of [0, 4]) {
      const f = fields();
      f.physical_qty = { declared: "on", source: "Conteo físico humano QA" };
      expect(
        pilotCountDeclarations({ ...values, physical_qty: qty }, f),
      ).toEqual({
        physical_qty: { declared_now: true, source: "Conteo físico humano QA" },
      });
    }
  });
  it("does not refresh evidence because a note was saved or a source remains displayed", () => {
    const f = fields();
    f.physical_qty.source = "Declaración anterior";
    expect(pilotCountDeclarations({ ...values, physical_qty: 3 }, f)).toEqual(
      {},
    );
  });
  it("rejects declaration when quantity is unknown", () => {
    const f = fields();
    f.physical_qty = { declared: "on", source: "Conteo físico humano QA" };
    expect(() => pilotCountDeclarations(values, f)).toThrow(
      "M9_FIELD_QUANTITY_REQUIRED",
    );
  });
  it.each(["", "abcd", "x".repeat(201), "Conteo\nQA", "Conteo\u0000QA"])(
    "rejects invalid source %s",
    (source) => {
      const f = fields();
      f.physical_qty = { declared: "on", source };
      expect(() =>
        pilotCountDeclarations({ ...values, physical_qty: 0 }, f),
      ).toThrow("M9_FIELD_DECLARATION_REQUIRED");
    },
  );
  it("does not accept another actor, date or auto-certification from the form", () => {
    const f = fields();
    f.physical_qty = { declared: "on", source: " Conteo en anaquel QA " };
    const result = pilotCountDeclarations({ ...values, physical_qty: 2 }, f);
    expect(result.physical_qty).toEqual({
      declared_now: true,
      source: "Conteo en anaquel QA",
    });
    expect(result.physical_qty).not.toHaveProperty("actor_user_id");
    expect(result.physical_qty).not.toHaveProperty("declared_at");
  });
  it("does not interpret another checkbox value as a human declaration", () => {
    const f = fields();
    f.physical_qty = { declared: "true", source: "Conteo físico humano QA" };
    expect(() =>
      pilotCountDeclarations({ ...values, physical_qty: 0 }, f),
    ).toThrow();
  });
  it("requires three current declarations before showing the complete comparison", () => {
    const current = {
      status: "DECLARED_CURRENT",
      actor_name: null,
      declaration: {
        kind: "HUMAN_DECLARATION_NOW",
        quantity: 0,
        count_certified: false,
      },
    } as PilotFieldView;
    const f = {
      physical_qty: current,
      sold_waiting_qty: current,
      separated_qty: current,
    };
    expect(pilotEvidenceComplete(f)).toBe(true);
    expect(
      pilotEvidenceComplete({
        ...f,
        separated_qty: { ...current, status: "UNKNOWN" },
      }),
    ).toBe(false);
    expect(
      pilotEvidenceComplete({
        ...f,
        separated_qty: {
          ...current,
          status: "HELD_SOURCE_OR_BASELINE_CHANGED",
        },
      }),
    ).toBe(false);
  });
  it("maps metadata and source failures without exposing private server details", () => {
    expect(legacyPilotFailure("M9_PILOT_BUSY_RETRY")).toBe("ocupado");
    expect(legacyPilotFailure("M9_FIELD_DECLARATION_REQUIRED")).toBe(
      "evidencia",
    );
    expect(legacyPilotFailure("M9_FIELD_QUANTITY_REQUIRED")).toBe("evidencia");
    expect(legacyPilotFailure("M9_FIELD_SOURCE_CHANGED")).toBe("base-cambiada");
    expect(legacyPilotFailure("private user source info")).toBe("error");
  });
});
