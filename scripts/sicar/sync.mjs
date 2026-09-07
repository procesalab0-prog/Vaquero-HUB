import { createHash } from "node:crypto";

import { decimalToCents, sicarBoolean } from "./analyzer.mjs";

export const SICAR_STAGING_PROJECT_REF = "zsezjtswqeijboezvado";

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function catalogRow(row) {
  const payload = {
    row_number: Number(row._row),
    legacy_key: String(row.clave1 ?? "").trim(),
    description: String(row.descripcion ?? "").trim(),
    characteristics: String(row.caracteristicas ?? "").trim() || null,
    department_name: String(row.departamento ?? "").trim() || null,
    category_name: String(row.categoria ?? "").trim() || null,
    cost_cents: decimalToCents(row.costo),
    price_cents: decimalToCents(row.precio1, { allowZero: false }),
    is_active: sicarBoolean(row.mostrar_ventas),
  };
  if (!Number.isInteger(payload.row_number) || payload.row_number < 2) {
    throw new Error(`INVALID_ROW_NUMBER: ${row._row}`);
  }
  if (!/^\d+$/.test(payload.legacy_key) || !payload.description) {
    throw new Error(`INVALID_CATALOG_ROW: ${payload.row_number}`);
  }
  return {
    ...payload,
    row_fingerprint: sha256Text(JSON.stringify(payload)),
  };
}

export function assertApprovedReport({ report, workbookSha, confirmSha }) {
  if (report?.schemaVersion !== 2 || report?.mode !== "DRY_RUN_READ_ONLY") {
    throw new Error("UNSUPPORTED_SICAR_REPORT");
  }
  const sourceSha = String(report?.source?.sha256 ?? "").toLowerCase();
  if (
    sourceSha !== workbookSha.toLowerCase() ||
    sourceSha !== confirmSha.toLowerCase()
  ) {
    throw new Error("SICAR_SHA_MISMATCH");
  }
  if (!report?.current?.gates?.canWriteCatalogStaging) {
    throw new Error(
      `SICAR_CATALOG_GATE_BLOCKED: ${report?.current?.gates?.catalogReason ?? report?.current?.gates?.reason ?? "reporte no aprobado"}`,
    );
  }
  if (
    !report?.barcodeVerification?.verified ||
    !report.barcodeVerification.reference ||
    !["EAN13", "CODE128", "LEGACY"].includes(
      report.barcodeVerification.symbology,
    )
  ) {
    throw new Error("SICAR_BARCODE_NOT_PHYSICALLY_VERIFIED");
  }
  return {
    sourceSha,
    symbology: report.barcodeVerification.symbology,
    barcodeTestReference: report.barcodeVerification.reference,
  };
}

export function assertStagingUrl(url) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== `${SICAR_STAGING_PROJECT_REF}.supabase.co`
  ) {
    throw new Error("SICAR_SYNC_REFUSES_NON_STAGING_PROJECT");
  }
}

function rpcData(result) {
  if (result.error) {
    throw new Error(
      `${result.error.message} [${result.error.code ?? "UNKNOWN"}]`,
    );
  }
  return result.data;
}

export async function applyCatalogSync({
  supabase,
  workbook,
  report,
  reportSha,
  approvedBy,
  batchSize = 400,
}) {
  const rows = workbook.rows.map(catalogRow);
  const stagedRun = rpcData(
    await supabase.rpc("stage_sicar_catalog_run", {
      p_source_sha256: workbook.sha256,
      p_source_file: report.source.file,
      p_source_sheet: report.source.sheet,
      p_report_sha256: reportSha,
      p_expected_rows: rows.length,
      p_barcode_symbology: report.barcodeVerification.symbology,
      p_barcode_test_reference: report.barcodeVerification.reference,
      p_approved_by_employee_code: approvedBy,
    }),
  );
  if (stagedRun.already_applied) return stagedRun.result;
  for (let index = 0; index < rows.length; index += batchSize) {
    rpcData(
      await supabase.rpc("stage_sicar_catalog_rows", {
        p_run_id: stagedRun.id,
        p_rows: rows.slice(index, index + batchSize),
      }),
    );
  }
  return rpcData(
    await supabase.rpc("apply_sicar_catalog_run", { p_run_id: stagedRun.id }),
  );
}
