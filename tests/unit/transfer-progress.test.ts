import { describe, expect, it } from "vitest";

import {
  transferCaption,
  transferProgress,
  transferStage,
} from "../../lib/transfer-progress";

describe("avance de un traspaso", () => {
  it("resume los estados internos en tres momentos", () => {
    expect(transferStage("REQUESTED")).toBe(0);
    expect(transferStage("APPROVED")).toBe(0);
    expect(transferStage("PREPARED")).toBe(0);
    expect(transferStage("IN_TRANSIT")).toBe(1);
    expect(transferStage("RECEIVED")).toBe(2);
    expect(transferStage("CANCELLED")).toBe(0);
  });

  it("recorre nada, la mitad o todo el camino", () => {
    expect(transferProgress(0)).toBe(0);
    expect(transferProgress(1)).toBe(0.5);
    expect(transferProgress(2)).toBe(1);
  });

  it("siempre lo dice con texto, con las sucursales reales", () => {
    expect(transferCaption("PREPARED", "La Piedad", "Zamora")).toBe(
      "Preparado · listo para salir de La Piedad",
    );
    expect(transferCaption("IN_TRANSIT", "La Piedad", "Zamora")).toBe(
      "En camino de La Piedad a Zamora",
    );
    expect(transferCaption("RECEIVED", "La Piedad", "Zamora")).toBe(
      "Recibido en Zamora",
    );
    expect(transferCaption("CANCELLED", "La Piedad", "Zamora")).toBe(
      "Traspaso cancelado",
    );
  });
});
