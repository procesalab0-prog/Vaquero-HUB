import { describe, expect, it } from "vitest";

import { isNavigationClick } from "../../lib/navigation-progress";

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
