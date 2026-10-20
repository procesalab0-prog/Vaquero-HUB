export type ReconciliationGraph = {
  generated_at: string;
  scope: string;
  source_at: string;
  accounts: Array<{
    key: string;
    name: string;
    used_cents: number;
    phone_present: boolean;
    candidates: number;
    linked: boolean;
  }>;
  documents: Array<{
    key: string;
    account: string;
    folio: string;
    status: string;
    total_cents: number;
    paid_cents: number;
    balance_cents: number;
    active_payment_cents: number;
    cancelled_payment_cents: number;
    payment_count: number;
    payment_evidence: string;
  }>;
  lines: Array<{
    document: string;
    index: number;
    barcode: string;
    quantity: string;
    variant: string | null;
    exact_variant: boolean;
  }>;
};
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
function sum(values: number[]) {
  const result = values.reduce((a, b) => a + BigInt(b), BigInt(0));
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("RECONCILIATION_OVERFLOW");
  return Number(result);
}
export function reconcileCustomers(
  graph: ReconciliationGraph,
  pilot: readonly string[],
  at: string,
) {
  if (
    graph.scope !== "APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS" ||
    !graph.accounts.length ||
    !graph.documents.length ||
    !Number.isFinite(Date.parse(at)) ||
    !Number.isFinite(Date.parse(graph.source_at)) ||
    Date.parse(graph.source_at) > Date.parse(at)
  )
    throw Error("RECONCILIATION_SCOPE_INVALID");
  if (
    !pilot.length ||
    new Set(pilot).size !== pilot.length ||
    pilot.some((c) => !c || c !== c.trim())
  )
    throw Error("PILOT_LITERAL_CODES_REQUIRED");
  const accounts = new Map(graph.accounts.map((c) => [c.key, c]));
  const documents = new Map(graph.documents.map((d) => [d.key, d]));
  if (
    accounts.size !== graph.accounts.length ||
    documents.size !== graph.documents.length
  )
    throw Error("DUPLICATE_SOURCE_IDENTITY");
  for (const c of graph.accounts)
    if (!integer(c.used_cents) || !integer(c.candidates))
      throw Error("INVALID_ACCOUNT_AMOUNT");
  for (const d of graph.documents) {
    if (
      !accounts.has(d.account) ||
      ![
        d.total_cents,
        d.paid_cents,
        d.balance_cents,
        d.active_payment_cents,
        d.cancelled_payment_cents,
        d.payment_count,
      ].every(integer) ||
      d.total_cents <= 0 ||
      !["PAID", "OPEN"].includes(d.status)
    )
      throw Error("INVALID_SOURCE_DOCUMENT");
  }
  const seen = new Set<string>();
  for (const l of graph.lines) {
    const key = l.document + "|" + l.index;
    if (
      !documents.has(l.document) ||
      !Number.isSafeInteger(l.index) ||
      l.index < 0 ||
      seen.has(key) ||
      !l.barcode ||
      l.barcode !== l.barcode.trim() ||
      !/^[1-9]\d*(?:\.0+)?$/.test(l.quantity)
    )
      throw Error("INVALID_SOURCE_LINE");
    seen.add(key);
  }
  const docRows = graph.documents.map((d) => ({
    ...d,
    reconciled:
      d.total_cents === d.paid_cents + d.balance_cents &&
      (d.status === "PAID"
        ? d.balance_cents === 0
        : d.balance_cents > 0 &&
          d.payment_evidence === "ACTIVE_AND_CANCELLED_RECONCILED" &&
          d.active_payment_cents === d.paid_cents),
    line_count: graph.lines.filter((l) => l.document === d.key).length,
  }));
  const accountRows = graph.accounts.map((c) => {
    const docs = docRows.filter((d) => d.account === c.key);
    const lines = graph.lines.filter((l) =>
      docs.some((d) => d.key === l.document),
    );
    return {
      ...c,
      document_count: docs.length,
      reconciled:
        c.used_cents === sum(docs.map((d) => d.balance_cents)) &&
        docs.every((d) => d.reconciled && d.line_count > 0),
      open_documents: docs.filter((d) => d.status === "OPEN").length,
      pilot_match: lines.some((l) => pilot.includes(l.barcode)),
      identity: c.linked
        ? "LINK_PRESENT_REQUIRES_REVALIDATION"
        : c.candidates
          ? "CANDIDATE_ONLY"
          : c.phone_present
            ? "NO_NATIVE_MATCH"
            : "CONTACT_PENDING",
      delivery: "UNKNOWN",
      operational_allowed: false,
    };
  });
  const pilotRows = pilot.map((barcode) => ({
    barcode,
    lines: graph.lines
      .filter((l) => l.barcode === barcode)
      .map((l) => ({
        document: l.document,
        folio: documents.get(l.document)!.folio,
        quantity: l.quantity,
        financial_status: documents.get(l.document)!.status,
        mapped: l.exact_variant,
        delivery: "UNKNOWN",
        additional_stock_deduction: null,
      })),
    importable_qty: null,
    reserved_qty: null,
    available_qty: null,
  }));
  const financialPass =
    docRows.every((d) => d.reconciled && d.line_count > 0) &&
    accountRows.every((c) => c.reconciled);
  return {
    version: "m9-customer-reconciliation-1",
    scope: graph.scope,
    source_at: graph.source_at,
    cut_fresh: Date.parse(at) - Date.parse(graph.source_at) <= 86400000,
    financial_pass: financialPass,
    operational_allowed: false,
    inventory_allowed: false,
    summary: {
      accounts: accountRows.length,
      documents: docRows.length,
      open_documents: docRows.filter((d) => d.status === "OPEN").length,
      paid_documents: docRows.filter((d) => d.status === "PAID").length,
      pending_cents: sum(docRows.map((d) => d.balance_cents)),
      active_payment_cents: sum(
        docRows
          .filter((d) => d.status === "OPEN")
          .map((d) => d.active_payment_cents),
      ),
      cancelled_payment_cents: sum(
        docRows.map((d) => d.cancelled_payment_cents),
      ),
      financial_exceptions:
        docRows.filter((d) => !d.reconciled).length +
        accountRows.filter((c) => !c.reconciled).length,
      native_candidates: sum(accountRows.map((c) => c.candidates)),
      linked_accounts: accountRows.filter((c) => c.linked).length,
      source_lines: graph.lines.length,
      exact_variant_lines: graph.lines.filter((l) => l.exact_variant).length,
      unknown_delivery_lines: graph.lines.length,
      pilot_codes: pilotRows.length,
      pilot_with_document: pilotRows.filter((p) => p.lines.length).length,
    },
    accounts: accountRows,
    documents: docRows,
    pilot: pilotRows,
  };
}
