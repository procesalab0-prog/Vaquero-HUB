// Pure, scoped measurements. No database, network, credentials, posting command
// or global weighting. Callers must verify the provenance of supplied evidence.
const project = "zsezjtswqeijboezvado";
const fail = (code) => {
  throw Error(code);
};
const count = (v) =>
  Number.isSafeInteger(v) && v >= 0 ? v : fail("NONNEGATIVE_INTEGER_REQUIRED");
const sum = (...xs) => {
  const v = xs.reduce((a, b) => a + BigInt(count(b)), 0n);
  return v <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(v)
    : fail("COUNT_OVERFLOW");
};
const time = (x) =>
  typeof x === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
    x,
  ) &&
  Number.isFinite(Date.parse(x))
    ? Date.parse(x)
    : fail("TIMESTAMP_REQUIRED");
const codeSet = (xs) => {
  if (
    !Array.isArray(xs) ||
    xs.some((s) => typeof s !== "string" || !s || s !== s.trim())
  )
    fail("LITERAL_CODES_REQUIRED");
  const set = new Set(xs);
  if (set.size !== xs.length) fail("DUPLICATE_LITERAL_CODE");
  return set;
};
const pct = (n, d) =>
  n === null || d === null || d === 0
    ? null
    : Number((BigInt(n) * 10000n + BigInt(d) / 2n) / BigInt(d)) / 100;
function metric(id, label, numerator, denominator, unit, scope, limitation) {
  if (numerator !== null) count(numerator);
  if (denominator !== null) count(denominator);
  if (numerator !== null && denominator !== null && numerator > denominator)
    fail("NUMERATOR_OUTSIDE_DENOMINATOR_SCOPE");
  return {
    id,
    label,
    numerator,
    denominator,
    unit,
    scope,
    percent_in_this_scope: pct(numerator, denominator),
    limitation,
    operational_authorization: false,
  };
}
const observation = (label, value, unit) => ({
  label,
  value,
  unit,
  counts_toward_global_progress: false,
});
function auditMap(rows, size) {
  if (!Array.isArray(rows) || rows.length !== size)
    fail("CLOSURE_AUDIT_SCOPE_MISMATCH");
  const out = new Map();
  for (const r of rows) {
    if (
      !/^(app|public)\.[a-z][a-z0-9_]*$/.test(r.name) ||
      !/^[a-f0-9]{32}$/.test(r.md5) ||
      out.has(r.name)
    )
      fail("INVALID_CLOSURE_AUDIT");
    count(r.rows);
    out.set(r.name, r);
  }
  return out;
}
export function evaluateMigrationMilestones({
  sourceRows,
  stagingCodes,
  sourceMetadata: source,
  coverage,
  measurement: m,
  closureAudit,
  measurementAudit = closureAudit,
  closureVerification: closure,
  connector,
  asOf,
}) {
  const now = time(asOf),
    at = time(m.observed_at);
  if (now < at || now - at > 15 * 60000)
    fail("MEASUREMENT_NOT_RECENT_FOR_REVIEW");
  if (
    m.protocol !== "m9-readiness-measurement-1" ||
    m.project_id !== project ||
    m.overview?.protocol !== "m9-parallel-overview-1" ||
    m.overview.read_only !== true ||
    m.overview.operational_authorization !== false
  )
    fail("READ_ONLY_STAGE_MEASUREMENT_REQUIRED");
  if (
    time(m.overview.assembled_at) < at ||
    time(m.overview.assembled_at) - at > 5000
  )
    fail("OVERVIEW_NOT_SAME_MEASUREMENT");
  if (
    source.protocol !== "m9-renewed-sicar-read-only-1" ||
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    source.sicar_modified !== false ||
    source.inventory_import_allowed !== false ||
    source.scope?.all_departments !== true ||
    source.scope?.all_categories !== true ||
    source.scope?.location_confirmed !== "La Piedad" ||
    source.scope?.warehouse !== "default" ||
    source.scope?.tax_inclusive_prices !== true ||
    source.scope?.packages !== false
  )
    fail("SICAR_FULL_LITERAL_SOURCE_REQUIRED");
  if (
    !Array.isArray(sourceRows) ||
    sourceRows.some((r) => r.fields?.["clave1 *"] !== r.barcode)
  )
    fail("SOURCE_CODE_PROJECTION_CHANGED");
  const codes = codeSet(sourceRows.map((r) => r.barcode)),
    loaded = codeSet(stagingCodes);
  const intersection = [...codes].filter((c) => loaded.has(c)).length;
  const outside = [...loaded].filter((c) => !codes.has(c)).length;
  const remaining = codes.size - intersection;
  if (
    coverage.scope !==
      "catalog_code_presence_only_not_global_or_operational_readiness" ||
    coverage.source_codes !== codes.size ||
    coverage.loaded_codes !== loaded.size ||
    coverage.source_in_staging !== intersection ||
    coverage.staging_not_in_source !== outside ||
    coverage.source_not_in_staging !== remaining ||
    coverage.coverage_percent !== pct(intersection, codes.size) ||
    m.overview.catalog.loaded_codes !== loaded.size
  )
    fail("LITERAL_COVERAGE_NOT_REPRODUCED");
  if (
    closure.protocol !== "m9-block3-offline-verification-1" ||
    closure.status !== "EVIDENCE_CHECKS_PASSED_NOT_OPERATIONAL_AUTHORIZATION" ||
    closure.operational_authorization !== false ||
    closure.unresolved !== 0 ||
    !Array.isArray(closure.checks) ||
    closure.checks.length === 0 ||
    closure.checks.some((c) => c.status !== "PASS")
  )
    fail("CLOSED_BLOCK_EVIDENCE_REQUIRED");
  const closedAudit = auditMap(closureAudit, 175);
  const audit = auditMap(measurementAudit, count(m.audit.app_public_tables));
  const rowCount = (name) =>
    audit.get(name)?.rows ?? fail("REQUIRED_AUDIT_TABLE_MISSING");
  const p = m.photos,
    inv = m.inventory,
    c = m.customers,
    v = m.overview,
    f = m.finance;
  for (const obj of [p, inv, c, f])
    for (const value of Object.values(obj))
      if (typeof value !== "boolean") count(value);
  if (
    sum(p.nonempty_evidence_variants, p.empty_evidence_variants) !==
      p.evidence_variants ||
    p.stored_nonempty_evidence_variants > p.nonempty_evidence_variants ||
    p.stored_nonempty_evidence_variants > p.copied_variant_rows ||
    p.evidence_variants !== v.catalog.photo_evidence_rows ||
    p.copied_variant_rows !== v.catalog.photo_storage_rows ||
    rowCount("app.web_variant_photo_evidence") !== p.evidence_variants ||
    rowCount("app.web_variant_photo_storage") !== p.copied_variant_rows ||
    rowCount("app.m9_rows") !== loaded.size
  )
    fail("PHOTO_OR_CATALOG_AUDIT_DRIFT");
  if (
    inv.required_fields !==
      sum(inv.pilot_codes, inv.pilot_codes, inv.pilot_codes) ||
    inv.pilot_codes !== v.inventory.codes ||
    inv.confirmed_fields + v.inventory.pending_fields !== inv.required_fields ||
    inv.fully_measured_codes > inv.pilot_codes ||
    inv.fully_measured_codes * 3 > inv.confirmed_fields
  )
    fail("PILOT_DENOMINATOR_MISMATCH");
  if (
    sum(c.raw_mapped_lines, c.raw_unmapped_lines) !== c.detail_lines ||
    c.raw_mapped_lines !== v.customers.mapped_lines ||
    c.raw_unmapped_lines !== v.customers.unmapped_lines ||
    c.sidecar_exact_on_previously_unmapped > c.raw_unmapped_lines ||
    c.sidecar_exact_on_previously_unmapped > c.sidecar_live_exact ||
    sum(c.confirmed_delivery_lines, v.customers.unconfirmed_deliveries) !==
      c.detail_lines ||
    c.sidecar_operational_permissions !== 0
  )
    fail("DOCUMENTARY_SCOPE_OR_PERMISSION_CHANGED");
  const effective = sum(
    c.raw_mapped_lines,
    c.sidecar_exact_on_previously_unmapped,
  );
  const controls = [
    v.woo.worker_enabled,
    v.woo.capture_enabled,
    v.woo.stock_pilot_enabled,
    v.woo.finance_enabled,
    f.web_enabled,
  ];
  if (controls.some((x) => x !== false))
    fail("EXPECTED_CLOSED_CONTROLS_CHANGED");
  if (
    rowCount("app.m9_web_settlement_events") !== f.web_events ||
    rowCount("app.m9_legacy_finance_ledger") !== f.legacy_test_ledger_rows ||
    rowCount("public.customer_credit_ledger") !==
      f.native_customer_credit_ledger_rows ||
    f.native_test_rehearsals !== v.woo.native_rehearsals
  )
    fail("FINANCIAL_AUDIT_DRIFT");
  if (
    connector.protocol !== "m9-sandbox-code-gap-evidence-1" ||
    connector.test_origin !==
      "https://salmon-nightingale-251188.hostingersite.com" ||
    connector.provider_receiver_enabled !== false ||
    connector.accredited_providers !== 0 ||
    connector.financial_reader_scope !== "CANCELLED_SYNTHETIC_ONLY" ||
    connector.global_outbound_blocked !== true ||
    connector.available_gateways_forced_empty !== true ||
    connector.public_checkout_blocked !== true ||
    connector.native_money_mode !== "SYNTHETIC_TEST_ONLY"
  )
    fail("REVIEWED_CONNECTOR_SCOPE_CHANGED");
  const censusFrom =
    v.customers.census_from === null ? null : time(v.customers.census_from);
  const censusStale = censusFrom === null ? null : now - censusFrom > 86400000;
  const detailFrom =
    v.customers.details_from === null ? null : time(v.customers.details_from);
  const detailsStale = detailFrom === null ? null : now - detailFrom > 86400000;
  const observations = {
    review_window_current: v.catalog.review_window.window_current,
    census_older_than_24h_at_review: censusStale,
    detail_older_than_24h_at_review: detailsStale,
    woo_source_date: source.woo_source_date,
    woo_full_export_renewed: source.woo_full_export_renewed,
    audit_tables: audit.size,
    closed_block_checks: closure.checks.length,
    closed_block_tables: closedAudit.size,
    closed_block_is_historical_not_latest_data_approval: true,
    missing_catalog_codes: remaining,
    staging_codes_outside_current_source: outside,
  };
  const milestones = [
    {
      id: "catalog",
      title: "Catálogo SICAR en staging",
      readiness: "PRESENCE_MEASURED_NOT_SALE_AUTHORIZATION",
      metrics: [
        metric(
          "source_code_presence",
          "Códigos del corte presentes",
          intersection,
          codes.size,
          "códigos SICAR literales",
          "SICAR_2026_10_22_FULL_CUT",
          "Presencia individual; no prueba agrupación, revisión vigente, venta ni existencias.",
        ),
      ],
      observations: [
        observation(
          "Revisiones archivadas, sin sumarlas a códigos",
          count(v.catalog.review_rows_on_file),
          "filas de revisión",
        ),
      ],
      blockers: [
        remaining ? "SOURCE_CODES_NOT_YET_REGISTERED" : null,
        outside ? "STAGING_CODES_NOT_IN_CURRENT_SOURCE" : null,
        v.catalog.review_window.window_current !== true
          ? "SALES_REVIEW_WINDOW_NOT_CURRENT"
          : null,
        "CATALOG_CHANGES_REQUIRE_SEPARATE_REVALIDATION",
        "FINAL_OPERATING_CUT_NOT_AUTHORIZED",
      ].filter(Boolean),
    },
    {
      id: "photos",
      title: "Fotos de Woo",
      readiness: "DOCUMENTED_COPY_SUBSET_MEASURED",
      metrics: [
        metric(
          "known_photo_copy",
          "Variantes con foto propia documentada y copia registrada",
          p.stored_nonempty_evidence_variants,
          p.nonempty_evidence_variants,
          "variantes dentro de la evidencia fotográfica",
          "NONEMPTY_REGISTERED_VARIANT_PHOTO_EVIDENCE",
          "Subconjunto documentado, no todo Woo; el conteo no revalida bytes ni publicación.",
        ),
        metric(
          "all_woo_photo_completion",
          "Cobertura fotográfica de todo Woo",
          null,
          null,
          "variantes/familias Woo de alcance completo aún no acreditado",
          "UNMEASURED_FULL_WOO_SCOPE",
          "No dividir copias entre productos, familias o códigos con unidades diferentes.",
        ),
      ],
      observations: [
        observation(
          "Ausencias explícitas preservadas",
          p.empty_evidence_variants,
          "variantes sin foto propia en evidencia",
        ),
        observation(
          "Evidencias registradas totales",
          p.evidence_variants,
          "variantes",
        ),
      ],
      blockers: [
        source.woo_full_export_renewed !== true
          ? "WOO_FULL_EXPORT_HISTORICAL"
          : null,
        "CURRENT_CATALOG_PHOTO_AND_CATEGORY_ELIGIBILITY_NOT_MEASURED",
        "PUBLICATION_NOT_AUTHORIZED",
      ].filter(Boolean),
    },
    {
      id: "inventory",
      title: "Inventario del piloto",
      readiness:
        inv.confirmed_fields === inv.required_fields && inv.pilot_codes > 0
          ? "PHYSICAL_FIELDS_RECORDED_NOT_OPENING_AUTHORIZATION"
          : "PHYSICAL_FIELDS_PENDING",
      metrics: [
        metric(
          "pilot_physical_fields",
          "Datos físicos completados",
          inv.confirmed_fields,
          inv.required_fields,
          "campos físicos",
          "THREE_PHYSICAL_FIELDS_PER_PILOT_CODE",
          "Completar no significa conciliar o abrir saldo; NULL no es cero.",
        ),
        metric(
          "pilot_complete_codes",
          "Códigos con los tres datos",
          inv.fully_measured_codes,
          inv.pilot_codes,
          "códigos del piloto",
          "PILOT_ONLY_NOT_FULL_CATALOG",
          "No extrapolar estos doce códigos al inventario de toda la tienda.",
        ),
      ],
      observations: [],
      blockers: [
        inv.confirmed_fields < inv.required_fields
          ? "PHYSICAL_COUNTS_INCOMPLETE"
          : null,
        "DELIVERIES_AND_SEPARATED_STOCK_NEED_RECONCILIATION",
        "INVENTORY_OPENING_NOT_AUTHORIZED",
      ].filter(Boolean),
    },
    {
      id: "customers",
      title: "Clientes, deudas y entregas",
      readiness: "ARCHIVED_DETAIL_IDENTITY_MEASURED_NOT_OPERATIONAL_OPENING",
      metrics: [
        metric(
          "archived_line_identity",
          "Identidades documentales exactas",
          effective,
          c.detail_lines,
          "líneas del archivo APARTADO",
          "LATEST_APARTADO_DETAIL_ARCHIVE_ONLY",
          "166 originales más vínculo exacto adicional; el archivo no se reescribe y lectores operativos no adoptan el sidecar.",
        ),
        metric(
          "archived_delivery_confirmed",
          "Entregas físicas confirmadas en ese archivo",
          c.confirmed_delivery_lines,
          c.detail_lines,
          "líneas del archivo APARTADO",
          "SAME_DETAIL_ARCHIVE_DELIVERY_STATUS",
          "UNKNOWN no significa pendiente de entregar ni entregado; no autoriza stock.",
        ),
        metric(
          "registered_accounts",
          "Cuentas conservadas en registro",
          count(v.customers.registered_legacy_accounts),
          null,
          "cuentas de origen registradas",
          "REGISTERED_SOURCE_ACCOUNTS_NOT_COMPLETE_CLIENT_CENSUS",
          "No hay denominador acreditado de todos los clientes; registro no es deuda ni socio.",
        ),
        metric(
          "eligible_debt_openings",
          "Documentos elegibles para apertura operativa actual",
          null,
          null,
          "documentos con corte y elegibilidad operativa acreditados",
          "NOT_YET_MEASURED",
          "Los siete saldos de ensayo previos no prueban elegibilidad de una nueva apertura.",
        ),
      ],
      observations: [
        observation(
          "Documentos en detalle archivado",
          count(v.customers.documents_reviewed),
          "documentos",
        ),
        observation(
          "Cuentas en ese detalle",
          count(v.customers.accounts_reviewed),
          "cuentas",
        ),
        observation(
          "Abonos históricos de ese detalle",
          count(v.customers.historical_payments),
          "abonos archivados",
        ),
        observation(
          "Saldo del libro separado de ensayo",
          f.legacy_test_ledger_net_cents,
          "centavos de siete saldos previos, no nuevas aperturas",
        ),
        observation(
          "Libro nativo de crédito",
          f.native_customer_credit_ledger_rows,
          "asientos nativos",
        ),
      ],
      blockers: [
        censusStale !== false ? "CUSTOMER_CENSUS_NEEDS_RENEWAL" : null,
        detailsStale !== false ? "DETAIL_CUT_NEEDS_RENEWAL" : null,
        effective < c.detail_lines ? "DOCUMENTARY_IDENTITIES_UNRESOLVED" : null,
        "SIDECAR_NOT_ADOPTED_BY_OPERATIONAL_READERS",
        "ACCOUNT_COMPLETE_FINANCIAL_REVIEW_NOT_MEASURED",
        c.confirmed_delivery_lines < c.detail_lines
          ? "PHYSICAL_DELIVERY_UNKNOWN_SEPARATE_FROM_MONEY"
          : null,
      ].filter(Boolean),
    },
    {
      id: "woo_orders_payments",
      title: "Pedidos y pagos de Woo",
      readiness: "AUTHENTICATED_SANDBOX_CYCLE_NOT_ACCREDITED",
      metrics: [
        metric(
          "first_authentic_cycle",
          "Ciclos completos con pago sandbox acreditado",
          0,
          1,
          "ciclos de aceptación externa",
          "EXPLICIT_FIRST_END_TO_END_PILOT_GOAL",
          "Objetivo de una campaña completa; ensayos sintéticos, firmas QA y pruebas SQL no cuentan.",
        ),
      ],
      observations: [
        observation(
          "Ensayos conectados sintéticos ya cerrados",
          count(v.woo.remote_connected_trials),
          "ensayos, no compras auténticas",
        ),
        observation(
          "Recibos nativos de ensayo con reversión",
          count(f.native_test_rehearsals),
          "recibos, no pagos",
        ),
        observation(
          "Eventos en libro web",
          count(f.web_events),
          "hechos sintéticos almacenados",
        ),
        observation(
          "Proveedores acreditados en el receptor actual",
          connector.accredited_providers,
          "proveedores",
        ),
      ],
      blockers: [
        "SANDBOX_PROVIDER_AND_ACCOUNT_NOT_ACCREDITED",
        "ISOLATION_PROFILE_BLOCKS_GATEWAYS_EGRESS_AND_CHECKOUT",
        "AUTHENTICATED_ORDER_AND_PROVIDER_TRANSPORT_MISSING",
        "WEB_MONEY_ADAPTER_REMAINS_SYNTHETIC_ONLY",
        "FULL_COMPONENTS_REFUNDS_AND_INVENTORY_ACCEPTANCE_PENDING",
        "NEW_CAMPAIGN_REQUIRES_SEPARATE_AUTHORIZATION_NO_SIXTH_TRIAL_HERE",
      ],
    },
  ];
  return {
    protocol: "m9-readiness-milestones-1",
    project_id: project,
    reviewed_at: asOf,
    measured_at: m.observed_at,
    operational_authorization: false,
    global_percent: null,
    estimated_delivery_at: null,
    aggregation_policy:
      "DO_NOT_SUM_CODES_PHOTO_VARIANTS_FIELDS_DOCUMENTS_AND_TESTS",
    unknown_is_not_zero: true,
    milestones,
    observations,
    conclusion:
      "El bloque 0.90 está acreditado. La migración completa conserva bloqueos de corte, conteo físico, elegibilidad financiera y proveedor sandbox; no se calcula porcentaje global ni fecha de entrega desde indicadores incompatibles.",
  };
}
