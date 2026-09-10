import { describe, expect, it } from "vitest";

import { pickActiveLocation } from "../../lib/location-preference";

const locations = [
  { id: "piedad", name: "La Piedad" },
  { id: "centro", name: "Centro" },
];

describe("selección de sucursal activa", () => {
  it("da prioridad a una sucursal válida solicitada en la navegación", () => {
    expect(pickActiveLocation(locations, "centro", "piedad")?.id).toBe(
      "centro",
    );
  });

  it("recupera la preferencia guardada cuando no viene en la URL", () => {
    expect(pickActiveLocation(locations, undefined, "centro")?.id).toBe(
      "centro",
    );
  });

  it("nunca acepta una ubicación que el empleado no tiene asignada", () => {
    expect(pickActiveLocation(locations, "ajena", "tambien-ajena")?.id).toBe(
      "piedad",
    );
  });
});
