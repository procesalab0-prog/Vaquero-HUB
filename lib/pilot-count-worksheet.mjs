const keys = ["physical_qty", "sold_waiting_qty", "separated_qty"];
export const PILOT_COUNT_CODES = Object.freeze([
  "2396",
  "12769",
  "11871",
  "606204203409",
  "10000",
  "10010",
  "10",
  "13988",
  "10536",
  "10055",
  "13038",
  "11920",
]);
const codes = PILOT_COUNT_CODES;
const location = "467765fe-d18e-43bb-be68-326adbf05ce1";
const uuid = (v) =>
  typeof v === "string" &&
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const quantity = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 999999;
const date = (v) => {
  if (typeof v !== "string") return false;
  const m =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00(?::00)?)$/.exec(
      v,
    );
  if (!m) return false;
  const canonical = `${m[1]}T${m[2]}.${(m[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
  return (
    Number.isFinite(Date.parse(canonical)) &&
    new Date(canonical).toISOString() === canonical
  );
};
const text = (v, max = 200) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  v === v.trim() &&
  !/\p{Cc}/u.test(v);
const needed = (ok, message) => {
  if (!ok) throw Error(message);
};

// A conservative display, never an inventory/import approval. No quantities are
// inferred from the source reference, financial status or missing evidence.
export function pilotCountProgress(stock) {
  const result = {
    codes: stock.length,
    required: stock.length * 3,
    unknown: 0,
    unattributed: 0,
    held: 0,
    declared_current: 0,
    import_allowed: false,
    count_certified: false,
  };
  for (const row of stock)
    for (const key of keys) {
      const value = row[key],
        evidence = row.field_evidence?.[key],
        d = evidence?.declaration;
      if (value === null) {
        result.unknown++;
        continue;
      }
      if (!quantity(value)) {
        result.held++;
        continue;
      }
      if (!d) {
        result.unattributed++;
        continue;
      }
      if (
        row.catalog_current === true &&
        row.balance_current === true &&
        hash(row.field_source_sha256) &&
        evidence.status === "DECLARED_CURRENT" &&
        d.kind === "HUMAN_DECLARATION_NOW" &&
        d.count_certified === false &&
        d.quantity === value &&
        d.source_snapshot_sha256 === row.field_source_sha256 &&
        uuid(d.actor_user_id) &&
        date(d.declared_at) &&
        text(d.source) &&
        d.source.length >= 5 &&
        Number.isSafeInteger(d.captured_revision) &&
        d.captured_revision >= 1 &&
        d.captured_revision <= row.revision
      )
        result.declared_current++;
      else result.held++;
    }
  return result;
}

// Optional archive references are projected independently from blank count cells.
// Strict keys prevent the metadata extension from exporting customer PII.
function documentReferencePacket(packet) {
  if (packet === undefined) return undefined;
  const exact = (obj, fields) =>
    obj &&
    typeof obj === "object" &&
    !Array.isArray(obj) &&
    Object.keys(obj).length === fields.length &&
    Object.keys(obj).every((k) => fields.includes(k));
  needed(
    exact(packet, [
      "protocol",
      "archive_sha256",
      "source_from",
      "source_until",
      "read_from",
      "read_until",
      "pages",
      "documents_scanned",
      "lines_scanned",
      "scope_codes",
      "complete",
      "current_commitments",
      "operational_import_allowed",
      "rows",
    ]) &&
      packet.protocol === "m9-pilot-document-references-1" &&
      hash(packet.archive_sha256) &&
      [
        packet.source_from,
        packet.source_until,
        packet.read_from,
        packet.read_until,
      ].every(date) &&
      Date.parse(packet.source_from) <= Date.parse(packet.source_until) &&
      Date.parse(packet.read_from) <= Date.parse(packet.read_until) &&
      Number.isSafeInteger(packet.pages) &&
      packet.pages >= 1 &&
      packet.pages <= 20 &&
      Number.isSafeInteger(packet.documents_scanned) &&
      packet.documents_scanned >= 0 &&
      packet.pages === Math.max(1, Math.ceil(packet.documents_scanned / 8)) &&
      Number.isSafeInteger(packet.lines_scanned) &&
      packet.lines_scanned >= 0 &&
      Array.isArray(packet.scope_codes) &&
      packet.scope_codes.length === codes.length &&
      new Set(packet.scope_codes).size === codes.length &&
      codes.every((code) => packet.scope_codes.includes(code)) &&
      packet.complete === true &&
      packet.current_commitments === "NOT_ASSESSED" &&
      packet.operational_import_allowed === false &&
      Array.isArray(packet.rows) &&
      packet.rows.length <= packet.lines_scanned,
    "PILOT_DOCUMENT_REFERENCES_INVALID",
  );
  const seen = new Set(),
    documents = new Map();
  const rows = packet.rows.map((row) => {
    const key = `${row?.document_key}/${row?.line_index}`;
    needed(
      exact(row, [
        "barcode",
        "document_key",
        "line_index",
        "folio",
        "source_at",
        "source_quantity",
        "source_evidence_sha256",
        "source_delivery_status",
      ]) &&
        codes.includes(row.barcode) &&
        hash(row.document_key) &&
        Number.isSafeInteger(row.line_index) &&
        row.line_index >= 0 &&
        typeof row.folio === "string" &&
        /^(?:[A-Z]{1,8}-?)?[0-9]{1,16}$/.test(row.folio) &&
        date(row.source_at) &&
        Date.parse(row.source_at) >= Date.parse(packet.source_from) &&
        Date.parse(row.source_at) <= Date.parse(packet.source_until) &&
        typeof row.source_quantity === "string" &&
        /^[1-9][0-9]{0,8}$/.test(row.source_quantity) &&
        hash(row.source_evidence_sha256) &&
        row.source_delivery_status === "UNKNOWN" &&
        !seen.has(key),
      "PILOT_DOCUMENT_REFERENCE_IDENTITY_INVALID",
    );
    const identity = JSON.stringify([
      row.folio,
      row.source_at,
      row.source_evidence_sha256,
    ]);
    needed(
      !documents.has(row.document_key) ||
        documents.get(row.document_key) === identity,
      "PILOT_DOCUMENT_REFERENCE_CONTEXT_CHANGED",
    );
    documents.set(row.document_key, identity);
    seen.add(key);
    return {
      barcode: row.barcode,
      document_key: row.document_key,
      line_index: row.line_index,
      folio: row.folio,
      source_at: row.source_at,
      source_quantity: row.source_quantity,
      source_evidence_sha256: row.source_evidence_sha256,
      source_delivery_status: "UNKNOWN",
    };
  });
  needed(
    documents.size <= packet.documents_scanned,
    "PILOT_DOCUMENT_REFERENCE_SCOPE_INCOMPLETE",
  );
  return { ...packet, scope_codes: [...codes], rows };
}

export function buildPilotCountWorksheet(stock, metadata) {
  needed(
    Array.isArray(stock) &&
      stock.length === 12 &&
      new Set(stock.map((r) => r.barcode)).size === 12 &&
      codes.every((code) => stock.some((r) => r.barcode === code)),
    "PILOT_WORKSHEET_SCOPE_CHANGED",
  );
  needed(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      [3, 4].includes(Object.keys(metadata).length) &&
      Object.keys(metadata).every((key) =>
        [
          "generated_at",
          "source_kind",
          "source_label",
          "document_references",
        ].includes(key),
      ) &&
      ["RPC_READ_NOW", "HISTORICAL_PINNED_READ"].includes(
        metadata.source_kind,
      ) &&
      text(metadata.source_label) &&
      date(metadata.generated_at) &&
      new Date(metadata.generated_at).toISOString() === metadata.generated_at,
    "PILOT_WORKSHEET_PROVENANCE_REQUIRED",
  );
  const references = documentReferencePacket(metadata.document_references);
  const seen = new Set();
  const rows = [...stock]
    .sort((a, b) => a.barcode.localeCompare(b.barcode, "en"))
    .map((row) => {
      needed(
        uuid(row.variant_id) &&
          !seen.has(row.variant_id) &&
          row.location_id === location &&
          quantity(row.observed_qty) &&
          date(row.observed_at) &&
          Number.isSafeInteger(row.revision) &&
          row.revision > 0 &&
          keys.every((key) => row[key] === null || quantity(row[key])),
        "PILOT_WORKSHEET_IDENTITY_OR_QUANTITY_INVALID",
      );
      seen.add(row.variant_id);
      return {
        barcode: row.barcode,
        variant_id: row.variant_id,
        location_id: row.location_id,
        product_name: text(row.name) ? row.name : null,
        source_reference: {
          quantity: row.observed_qty,
          observed_at: row.observed_at,
          meaning: "SICAR_REFERENCE_ONLY_SEMANTICS_NOT_CONFIRMED",
        },
        draft_revision: row.revision,
        expected_source_sha256: hash(row.field_source_sha256)
          ? row.field_source_sha256
          : null,
        draft_quantities_snapshot: Object.fromEntries(
          keys.map((key) => [key, row[key]]),
        ),
        draft_progress: pilotCountProgress([row]),
        // A printed old draft is never re-declared by copying or exporting it.
        capture: Object.fromEntries(
          keys.map((key) => [
            key,
            {
              quantity: null,
              evidence_ref: null,
              observed_at: null,
              counted_by: null,
            },
          ]),
        ),
        commitment_references: [],
        import_allowed: false,
      };
    });
  return {
    protocol: "m9-pilot-count-worksheet-1",
    ...metadata,
    ...(references ? { document_references: references } : {}),
    location_name: "La Piedad · Default",
    source_warehouse_mapping_confirmed: true,
    source_quantity_semantics_confirmed: false,
    progress: pilotCountProgress(stock),
    rows,
    required_commitment_fields: [
      "barcode_literal",
      "document_key_or_folio",
      "source_line_index",
      "quantity",
      "physical_present_evidence",
      "sold_waiting_OR_separated",
      "prior_inventory_effect_evidence_OR_UNKNOWN",
    ],
    guidance: [
      "Definición de captura: físico incluye piezas presentes en anaquel, bodega y mercancía guardada o separada.",
      "Vendido y guardado y separado sin venta son subconjuntos disjuntos del físico. No contar la misma pieza en ambos.",
      "Vacío permanece pendiente. Cero requiere comprobación expresa, incluso si SICAR no muestra coincidencias.",
      "Un folio, abono o saldo no prueba entrega, presencia física ni descuento previo. Revisar documento y línea sin nombres de clientes.",
      "La existencia SICAR es una referencia con fecha propia; su semántica no está confirmada. No copiarla al físico ni restar compromisos automáticamente.",
      "Pedir reporte SICAR de movimientos por código/almacén/corte y detalle completo de documentos y entregas. Si falta evidencia del efecto previo, mantener UNKNOWN y retener la conciliación.",
      "Declarar en el formulario original sólo lo revisado ahora. La hoja no certifica, importa, reserva ni descuenta inventario.",
    ],
    operational_import_allowed: false,
    inventory_written: false,
    reservations_written: false,
  };
}

const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function renderDocumentReferences(sheet) {
  const ref = documentReferencePacket(sheet.document_references);
  if (!ref) return "";
  return `<section><h2>Referencias documentales del archivo · no son compromisos confirmados</h2><p>Archivo ${esc(ref.archive_sha256)}. Fuente original: ${esc(ref.source_from)} a ${esc(ref.source_until)}. Lectura de referencia: ${esc(ref.read_from)} a ${esc(ref.read_until)}; ${ref.pages} páginas, ${ref.documents_scanned} documentos y ${ref.lines_scanned} renglones comprobados. Varias consultas distintas: no es un cierre simultáneo ni renueva SICAR.</p><p>La cantidad original es sólo una referencia escrita en el documento. Toda entrega física sigue UNKNOWN. No acredita presencia, reserva, separación, venta guardada ni descuento previo.</p>${ref.rows.length ? `<div class="scroll"><table><thead><tr><th>Código literal</th><th>Folio / documento / índice de origen</th><th>Cantidad ORIGINAL de referencia</th><th>Fecha y evidencia originales</th><th>Estado físico</th></tr></thead><tbody>${ref.rows.map((row) => `<tr><td><code>${esc(row.barcode)}</code></td><td>${esc(row.folio)}<small>${esc(row.document_key)} / índice ${row.line_index} (origen)</small>${sheet.source_kind === "RPC_READ_NOW" ? `<a href="/migracion/entregas?${esc(new URLSearchParams({ document: row.document_key, review_filter: "all" }).toString())}#documentos">Revisar folio en el programa</a>` : ""}</td><td>${esc(row.source_quantity)}<small>No son piezas actuales acreditadas.</small></td><td>${esc(row.source_at)}<small>${esc(row.source_evidence_sha256)}</small></td><td>UNKNOWN · Sin confirmar</td></tr>`).join("")}</tbody></table></div>` : `<p>Sin coincidencia en este archivo histórico; compromisos actuales no evaluados.</p>`}<p>La ausencia de un código aquí no acredita cero compromisos. El archivo sólo cubre los documentos capturados de ese corte: faltan posibles documentos nuevos, liquidados o no incluidos. Comprobarlos con la tienda antes de llenar V o S; no copiar estas referencias a las casillas físicas.</p></section>`;
}

export function renderPilotCountWorksheet(sheet) {
  needed(
    sheet?.protocol === "m9-pilot-count-worksheet-1" &&
      sheet.operational_import_allowed === false,
    "PILOT_WORKSHEET_REQUIRED",
  );
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conteo piloto · La Piedad</title><style>body{font:15px/1.45 system-ui;color:#172e38;max-width:1200px;margin:24px auto;padding:0 18px}h1,h2{line-height:1.2}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #89949a;text-align:left;padding:8px;vertical-align:top}small{display:block;overflow-wrap:anywhere}.scroll{overflow:auto}.warning{background:#fff2d2;padding:14px}.blank{min-width:80px;height:44px}code{overflow-wrap:anywhere}@media print{@page{size:A4 landscape;margin:12mm}body{font-size:10px;margin:0;padding:0}th,td{padding:5px}tr{break-inside:avoid}.commitments{break-before:page}.warning{background:none;border:1px solid}.scroll{overflow:visible}}@media(max-width:600px){body{font-size:14px}th,td{padding:6px}}</style>
<h1>Hoja de comprobación · La Piedad</h1><p class="warning">Sólo borrador. ${sheet.rows.length} códigos / ${sheet.progress.required} campos. Casillas vacías: pendiente; no significan cero. No autoriza carga ni venta.</p>
<p>Generada: ${esc(sheet.generated_at)} · Fuente: ${esc(sheet.source_label)} (${esc(sheet.source_kind)}). La generación no renueva la referencia SICAR. Fecha del conteo: __________ Responsable: __________ Segundo revisor: __________</p>
<ol>${sheet.guidance.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<div class="scroll"><table><thead><tr><th>Código literal / producto</th><th>Referencia SICAR histórica</th><th>Físico total</th><th>Vendido y guardado</th><th>Separado sin venta</th><th>Fuentes / hora / responsable por campo</th></tr></thead><tbody>${sheet.rows.map((r) => `<tr><td><code>${esc(r.barcode)}</code>${r.product_name ? `<small>${esc(r.product_name)}</small>` : ""}<small>Rev. ${r.draft_revision} · La Piedad</small></td><td>${r.source_reference.quantity}<small>${esc(r.source_reference.observed_at)}</small><small>No copiar como físico.</small></td><td class="blank">________</td><td class="blank">________</td><td class="blank">________</td><td>F: __________________<br>V: __________________<br>S: __________________</td></tr>`).join("")}</tbody></table></div>
${renderDocumentReferences(sheet)}<section class="commitments"><h2>Comprobación de compromisos · sin datos de clientes</h2><p>Una fila por documento y línea/código. No repetir una pieza en V y S. Si falta identificar el descuento previo, anotar UNKNOWN y retener; esta hoja nunca genera otro descuento.</p><div class="scroll"><table><thead><tr><th>Código literal</th><th>Folio / clave de documento + índice de línea</th><th>Piezas presentes y cómo se comprobaron</th><th>V o S (uno)</th><th>Movimiento SICAR previo / UNKNOWN</th></tr></thead><tbody>${Array.from({ length: 12 }, () => '<tr><td class="blank"></td><td></td><td></td><td></td><td></td></tr>').join("")}</tbody></table></div><p>Los folios revisados en entregas siguen siendo evidencia documental. No llenan automáticamente esta hoja ni acreditan reserva/descuento. No anotar nombres, teléfonos, saldos ni datos de pago de clientes.</p><p>Reportes pendientes: conteo físico por área; documentos/entregas y mercancía guardada de todos los tipos; movimientos SICAR por código, almacén Default y mismo corte, incluyendo cancelaciones. Ausencia de una búsqueda no acredita cero.</p></section></html>\n`;
}
