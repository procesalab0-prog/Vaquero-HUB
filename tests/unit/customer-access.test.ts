import { describe, expect, it } from "vitest";

import {
  customerAuthIdentityAttributes,
  parseCustomerIdentifier,
} from "../../lib/customer-access";
import {
  parseOfflineCustomerCard,
  serializeOfflineCustomerCard,
} from "../../lib/customer-card-storage";

describe("acceso y tarjeta del cliente", () => {
  it("normaliza teléfono y correo sin aceptar identificadores inválidos", () => {
    expect(parseCustomerIdentifier("01 353 123 4567")).toEqual({
      channel: "phone",
      value: "+523531234567",
    });
    expect(parseCustomerIdentifier(" Cliente@Ejemplo.COM ")).toEqual({
      channel: "email",
      value: "cliente@ejemplo.com",
    });
    expect(parseCustomerIdentifier("cliente@invalido")).toBeNull();
    expect(parseCustomerIdentifier("1234")).toBeNull();
  });

  it("prepara identidades passwordless confirmadas para Auth", () => {
    expect(
      customerAuthIdentityAttributes({
        channel: "email",
        value: "cliente@ejemplo.com",
      }),
    ).toEqual({ email: "cliente@ejemplo.com", email_confirm: true });
    expect(
      customerAuthIdentityAttributes({
        channel: "phone",
        value: "+523531234567",
      }),
    ).toEqual({ phone: "+523531234567", phone_confirm: true });
  });

  it("persiste únicamente una tarjeta versionada con socio válido", () => {
    const serialized = serializeOfflineCustomerCard("10000016");
    expect(JSON.parse(serialized)).toEqual({
      version: 1,
      memberNumber: "10000016",
    });
    expect(parseOfflineCustomerCard(serialized)).toEqual({
      version: 1,
      memberNumber: "10000016",
    });
    expect(
      parseOfflineCustomerCard(
        '{"version":1,"memberNumber":"10000016","fullName":"No guardar"}',
      ),
    ).toEqual({ version: 1, memberNumber: "10000016" });
  });
});
