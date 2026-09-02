import { describe, expect, it } from "vitest";

import {
  customerAuthIdentityAttributes,
  customerRedirectUrl,
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

  it("nunca adivina el destino del enlace de acceso", () => {
    const original = process.env.CUSTOMER_APP_URL;

    process.env.CUSTOMER_APP_URL = "https://mi.ejemplo.com/acceso";
    expect(
      customerRedirectUrl("https://cualquier-cosa.com/api/mi/acceso"),
    ).toBe("https://mi.ejemplo.com/acceso");

    delete process.env.CUSTOMER_APP_URL;
    expect(customerRedirectUrl("http://localhost:3000/api/mi/acceso")).toBe(
      "http://localhost:3000/mi",
    );

    // Sin configuración y fuera de local: falla en lugar de mandar el token
    // a un dominio adivinado.
    expect(() =>
      customerRedirectUrl("https://otro-host.com/api/mi/acceso"),
    ).toThrow(/CUSTOMER_APP_URL_NOT_CONFIGURED/);

    if (original === undefined) delete process.env.CUSTOMER_APP_URL;
    else process.env.CUSTOMER_APP_URL = original;
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
