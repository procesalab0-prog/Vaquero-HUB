import { describe, expect, it } from "vitest";

import {
  isNavigationClick,
  navigationLabel,
} from "../../lib/navigation-progress";

const click = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};
const here = {
  origin: "https://mitienda.example",
  pathname: "/inicio",
  search: "?ubicacion=lap",
};
const link = (
  href: string,
  extra: Partial<{ target: string; download: boolean }> = {},
) => ({
  href,
  target: "",
  download: false,
  ...extra,
});

describe("cambio de página", () => {
  it("cuenta los enlaces a otra página del programa", () => {
    expect(isNavigationClick(click, link("/pos?ubicacion=lap"), here)).toBe(
      true,
    );
    expect(isNavigationClick(click, link("/inicio?ubicacion=zam"), here)).toBe(
      true,
    );
  });

  it("ignora la misma página, anclas, otros sitios y descargas", () => {
    expect(isNavigationClick(click, link("#notas"), here)).toBe(false);
    expect(isNavigationClick(click, link("/inicio?ubicacion=lap"), here)).toBe(
      false,
    );
    expect(
      isNavigationClick(click, link("/inicio?ubicacion=lap#notas"), here),
    ).toBe(false);
    expect(
      isNavigationClick(
        click,
        link("https://procesa-lab-web.vercel.app"),
        here,
      ),
    ).toBe(false);
    expect(
      isNavigationClick(click, link("/ticket.pdf", { download: true }), here),
    ).toBe(false);
    expect(
      isNavigationClick(click, link("/pos", { target: "_blank" }), here),
    ).toBe(false);
  });

  it("ignora abrir en otra pestaña con teclas o botón central", () => {
    expect(
      isNavigationClick({ ...click, ctrlKey: true }, link("/pos"), here),
    ).toBe(false);
    expect(isNavigationClick({ ...click, button: 1 }, link("/pos"), here)).toBe(
      false,
    );
  });
});

describe("nombre de la sección destino", () => {
  const origin = "https://mitienda.example";

  it("se toma de la dirección a la que se va", () => {
    expect(navigationLabel({ href: "/inventario?ubicacion=lap" }, origin)).toBe(
      "Inventario",
    );
    expect(
      navigationLabel({ href: "/administracion?tab=sucursales" }, origin),
    ).toBe("Administración");
    expect(navigationLabel({ href: "/pos" }, origin)).toBe("Punto de venta");
  });

  it("acepta un texto propio y, sin datos, no inventa nada", () => {
    expect(navigationLabel({ label: "Cambiando de sucursal" }, origin)).toBe(
      "Cambiando de sucursal",
    );
    expect(navigationLabel({}, origin)).toBe("");
  });
});
