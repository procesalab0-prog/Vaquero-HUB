import { describe, expect, it } from "vitest";
import { renderCustomerTicketEmail } from "../../lib/customer-ticket-email";

describe("correo de ticket protegido", () => {
  it("envía a la cuenta privada, sin datos de compra ni enlaces públicos al ticket", () => {
    const mail = renderCustomerTicketEmail({
      folio: "V-123",
      customerAppUrl: "https://vaquero-hub.vercel.app/mi",
    });
    expect(mail.subject).toContain("V-123");
    expect(mail.text).toContain("Mis tickets");
    expect(mail.html).toContain('href="https://vaquero-hub.vercel.app/mi"');
    expect(mail.html).not.toContain("token=");
    expect(mail.text).toContain("no es una factura");
  });
  it("no permite que un folio inyecte HTML ni cabeceras de correo", () => {
    const mail = renderCustomerTicketEmail({
      folio: '<img src=x onerror="alert(1)">',
      customerAppUrl: "https://example.test/mi",
    });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
    expect(() =>
      renderCustomerTicketEmail({
        folio: "V1\r\nBcc: otro@example.test",
        customerAppUrl: "https://example.test/mi",
      }),
    ).toThrow("INVALID_TICKET_FOLIO");
  });
  it.each([
    "javascript:alert(1)",
    "http://example.test/mi",
    "https://user:secret@example.test/mi",
    "https://example.test/mi?token=secret",
    "https://example.test/mi#token",
    "https://example.test/tickets/V1",
  ])("rechaza enlaces inseguros o tokens: %s", (customerAppUrl) => {
    expect(() =>
      renderCustomerTicketEmail({ folio: "V1", customerAppUrl }),
    ).toThrow();
  });
});
