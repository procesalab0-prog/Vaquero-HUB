import { describe, expect, it } from "vitest";
import {
  generalCustomerCensus,
  generalDetailQueue,
  openRows,
  censusHTML,
} from "../../scripts/m9/prepare-general-customers.mjs";
const at = "2026-10-21T18:00:00Z",
  ref = "00000000-0000-4000-8000-000000000001";
const document = (folio = "148", total = "$10.00", balance = "$7.00") =>
  `\n        - row "10/20/2026 10:00:00 AM ${folio} ${total} MXN ${balance}":\n          - cell:\n            - paragraph: 10/20/2026 10:00:00 AM\n            - button "${folio}":\n          - cell:\n            - paragraph: ${total} MXN\n            - paragraph: ${balance}`;
const fixture = () => ({
  list: {
    captured_at: at,
    state: '- combobox "Buscar"\n- button "0":\n',
    rows: [
      {
        list_index: 0,
        paragraphs: ["", "QA Cliente"],
        text: "QA Cliente $7.00",
      },
    ],
  },
  captures: [
    {
      list_index: 0,
      name: "QA Cliente",
      client_ref: ref,
      url: `https://app.sicarx.com/clients/detail/${ref}`,
      full_reload_before_read: true,
      captured_at: at,
      credit:
        "QA Cliente\n    - text: Saldo utilizado\n    - paragraph: $7.00\n    - text: Saldo vencido\n    - paragraph: $0.00" +
        document() +
        '\n        - row:\n          - cell\n- button "Abrir Ayuda SICAR X":',
      rows: ["$10.00 MXN $7.00"],
    },
  ],
  previous: { customers: [], documents: [] },
});
const run = (f: ReturnType<typeof fixture>) =>
  generalCustomerCensus(f.list, f.captures, f.previous, at);
describe("general customer census preserves source identity without opening financial balances", () => {
  it("preserves numeric historical folios without adding VSM", () => {
    const p = run(fixture());
    expect(p.accounts[0].documents[0].folio).toBe("148");
    expect(p.accounts[0].documents[0]).toMatchObject({
      balance_cents: 700,
      source_document_id: null,
      payment_details_verified: false,
      delivery_status: "UNKNOWN",
    });
    expect(p.operational_import_allowed).toBe(false);
  });
  it("never fills missing account balances from row sums or listing amounts", () => {
    const f = fixture();
    f.captures[0].credit = f.captures[0].credit.replace(
      "    - text: Saldo utilizado\n    - paragraph: $7.00",
      "    - generic: Saldo utilizado",
    );
    const p = run(f);
    expect(p.accounts[0].used_cents).toBeNull();
    expect(p.summary).toMatchObject({
      source_used_cents: 0,
      document_balance_cents: 700,
      accounts_with_unknown_used: 1,
    });
    expect(p.accounts[0].holds).toContain("SOURCE_BALANCE_MISSING");
  });
  it("holds a discrepancy instead of overwriting either amount", () => {
    const f = fixture();
    f.captures[0].credit = f.captures[0].credit.replace(
      "paragraph: $7.00",
      "paragraph: $8.00",
    );
    const a = run(f).accounts[0];
    expect(a.used_cents).toBe(800);
    expect(a.document_balance_cents).toBe(700);
    expect(a.holds).toContain("DOCUMENT_BALANCE_MISMATCH");
    expect(a.holds).toContain("LIST_BALANCE_CHANGED");
  });
  it("rejects incomplete capture, repeated IDs and wrong source identity", () => {
    const f = fixture();
    expect(() => generalCustomerCensus(f.list, [], f.previous, at)).toThrow(
      "COMPLETE_DISTINCT_CUSTOMERS_REQUIRED",
    );
    f.captures[0].url = "https://app.sicarx.com/clients/detail/incorrecto";
    expect(() => run(f)).toThrow("CUSTOMER_IDENTITY_EVIDENCE_REQUIRED");
  });
  it("preserves equal names as separate customers and blocks name-only merges", () => {
    const f = fixture();
    f.list.rows.push({ ...f.list.rows[0], list_index: 1 });
    f.captures.push({
      ...f.captures[0],
      list_index: 1,
      client_ref: "00000000-0000-4000-8000-000000000002",
      url: "https://app.sicarx.com/clients/detail/00000000-0000-4000-8000-000000000002",
    });
    const p = run(f);
    expect(
      new Set(p.accounts.map((a: { customer_key: string }) => a.customer_key))
        .size,
    ).toBe(2);
    expect(
      p.accounts.every((a: { holds: string[] }) =>
        a.holds.includes("DUPLICATE_NAME_NOT_MERGED"),
      ),
    ).toBe(true);
    f.captures[1].client_ref = ref;
    expect(() => run(f)).toThrow("COMPLETE_DISTINCT_CUSTOMERS_REQUIRED");
  });
  it("requires an unfiltered final list and fresh fully reloaded captures", () => {
    for (const suffix of ["progressbar", ""]) {
      const f = fixture();
      if (suffix) f.list.state += suffix;
      else
        f.list.state = f.list.state.replace('"Buscar"', '"Buscar": APARTADO');
      expect(() => run(f)).toThrow("UNFILTERED_TERMINAL_LIST_REQUIRED");
    }
    for (const captured_at of [
      "2026-10-19T18:00:00Z",
      "2026-10-22T18:00:00Z",
    ]) {
      const f = fixture();
      f.captures[0].captured_at = captured_at;
      expect(() => run(f)).toThrow();
    }
    const f = fixture();
    f.captures[0].full_reload_before_read = false;
    expect(() => run(f)).toThrow();
  });
  it("rejects malformed amounts, duplicated folios and overpaid rows", () => {
    expect(() => openRows(document().replace("MXN", "USD"))).toThrow(
      "SOURCE_CURRENCY_REQUIRED",
    );
    expect(() => openRows(document("1", "$7.00", "$8.00"))).toThrow();
    expect(() => openRows(document("1") + document("1"))).toThrow(
      "DUPLICATE_DOCUMENT_FOLIO",
    );
    expect(() => openRows(document("1", "$10.00", "$7.000"))).toThrow();
  });
  it("links previous document IDs by full identity key, never by folio alone", () => {
    const p = run(fixture());
    expect(
      generalDetailQueue(p, {
        documents: [
          {
            document_key: "another-account",
            source_folio: "148",
            financial_status: "OPEN",
            source_document_id: "other",
          },
        ],
      })[0].expected_source_document_id,
    ).toBeNull();
    const q = generalDetailQueue(p, {
      documents: [
        {
          document_key: p.accounts[0].documents[0].document_key,
          financial_status: "OPEN",
          source_document_id: "verified-old-reference",
        },
      ],
    });
    expect(q[0]).toMatchObject({
      folio: "148",
      client_ref: ref,
      expected_source_document_id: "verified-old-reference",
      in_previous_package: true,
      detail_and_linked_payments_required: true,
      operational_import_allowed: false,
    });
  });
  it("escapes source text in the private review report", () => {
    const p = run(fixture());
    p.accounts[0].name = "<img src=x onerror=alert(1)>";
    const html = censusHTML(p);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
    expect(html).toContain("No habilita cobros");
  });
});
