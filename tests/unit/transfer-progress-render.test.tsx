import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TransferProgress } from "../../app/(workspace)/inventario/transfer-progress";
import type { InventoryTransfer } from "../../lib/domain";

const render = (status: InventoryTransfer["status"]) =>
  renderToStaticMarkup(
    <TransferProgress
      transfer={{
        id: "t1",
        status,
        fromLocationName: "La Piedad",
        toLocationName: "Zamora",
      }}
    />,
  );

describe("recorrido de un traspaso en pantalla", () => {
  it("nombra siempre los tres momentos y el estado con texto", () => {
    for (const status of [
      "REQUESTED",
      "PREPARED",
      "IN_TRANSIT",
      "RECEIVED",
      "CANCELLED",
    ] as const) {
      const html = render(status);
      expect(html).toContain("Enviado");
      expect(html).toContain("En tránsito");
      expect(html).toContain("Recibido");
      expect(html).toContain('class="transfer-progress-caption"');
    }
    expect(render("IN_TRANSIT")).toContain("En camino de La Piedad a Zamora");
  });

  it("marca el paso actual para lectores de pantalla", () => {
    const html = render("IN_TRANSIT");
    const current = html.indexOf('aria-current="step"');
    expect(current).toBeGreaterThan(-1);
    expect(html.indexOf("En tránsito", current)).toBeGreaterThan(current);
    expect(render("RECEIVED")).toContain('data-stage="2"');
    expect(render("PREPARED")).toContain('data-stage="0"');
  });

  it("no anima nada al aparecer: sólo avanza cuando cambia frente a quien lo mira", () => {
    expect(render("IN_TRANSIT")).not.toContain("data-advancing");
  });

  it("un traspaso cancelado no muestra el camión en camino", () => {
    const html = render("CANCELLED");
    expect(html).toContain("data-cancelled");
    expect(html).not.toContain("transfer-head");
  });
});
