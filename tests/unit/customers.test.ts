import { describe, expect, it } from "vitest";

import {
  isValidMemberNumber,
  memberCheckDigit,
  normalizeMexicanPhone,
} from "../../lib/customers";

describe("identidad de clientes", () => {
  it("normaliza variantes del mismo teléfono mexicano", () => {
    for (const value of [
      "3531234567",
      "+52 353 123 4567",
      "0052 353 123 4567",
      "01 353 123 4567",
    ]) {
      expect(normalizeMexicanPhone(value)).toBe("+523531234567");
    }
    expect(normalizeMexicanPhone("123")).toBeNull();
  });

  it("valida el dígito verificador del número de socio", () => {
    expect(memberCheckDigit("1234567")).toBe(4);
    expect(isValidMemberNumber("12345674")).toBe(true);
    expect(isValidMemberNumber("12345675")).toBe(false);
  });
});
