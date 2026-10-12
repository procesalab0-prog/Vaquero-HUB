// Pure renderer for a future server-only transactional delivery adapter.
// This does not authorize a recipient, fetch a sale, or send a message.
export type CustomerTicketEmail = {
  folio: string;
  customerAppUrl: string;
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

export function renderCustomerTicketEmail(input: CustomerTicketEmail) {
  const folio = input.folio.trim();
  if (
    !folio ||
    folio.length > 80 ||
    Array.from(folio).some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error("INVALID_TICKET_FOLIO");
  }
  // Callers must use the configured customer origin, never a URL supplied by
  // a recipient. No session tokens or public receipt links in this template.
  const url = new URL(input.customerAppUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/mi"
  ) {
    throw new Error("INVALID_CUSTOMER_EMAIL_URL");
  }
  const subject = `Tu ticket ${folio} · Vaquero SM`;
  const text = `Tu ticket ${folio} ya está disponible en Mi Vaquero SM.\nEntra a tu cuenta y abre Mis tickets para consultarlo o descargarlo.\n${url.href}\nEste correo no es una factura fiscal.`;
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><body style="background:#f3efe7;font-family:Arial,sans-serif;padding:24px;color:#1c2f3a"><div style="max-width:520px;margin:auto;background:white;border-radius:16px;padding:32px"><p><strong>VAQUERO SM</strong></p><h1 style="font-size:24px">Tu ticket está listo</h1><p>Ticket <strong>${escapeHtml(folio)}</strong></p><p>Entra a Mi Vaquero SM y abre <strong>Mis tickets</strong> para consultarlo o descargarlo.</p><p><a href="${escapeHtml(url.href)}" style="display:inline-block;background:#1c2f3a;color:white;padding:14px 20px;border-radius:8px">Ver mis tickets</a></p><p style="font-size:13px;color:#666">Este correo no es una factura fiscal.</p></div></body></html>`;
  return { subject, text, html };
}
