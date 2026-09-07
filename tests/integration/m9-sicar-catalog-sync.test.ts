import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const server = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anonymous = createClient(url, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const stamp = Date.now().toString();
const keyA = `91${stamp.slice(-10)}`;
const keyB = `92${stamp.slice(-10)}`;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function luhn(payload: string) {
  let sum = 0;
  for (let position = payload.length - 1; position >= 0; position -= 1) {
    let digit =
      Number(payload[position]) *
      ((payload.length - 1 - position) % 2 === 0 ? 2 : 1);
    if (digit > 9) digit -= 9;
    sum += digit;
  }
  return `${payload}-${(10 - (sum % 10)) % 10}`;
}

function ean13(payload: string) {
  const sum = [...payload].reduce(
    (total, digit, index) =>
      total + Number(digit) * ((index + 1) % 2 === 0 ? 3 : 1),
    0,
  );
  return `${payload}${(10 - (sum % 10)) % 10}`;
}

function stagedRow(
  rowNumber: number,
  legacyKey: string,
  overrides: Record<string, unknown> = {},
) {
  const base = {
    row_number: rowNumber,
    legacy_key: legacyKey,
    description: `Producto SICAR ${legacyKey}`,
    characteristics: "Prueba M9",
    department_name: "PRUEBAS",
    category_name: "Accesorios",
    cost_cents: 10000,
    price_cents: 25000,
    is_active: true,
    ...overrides,
  };
  return { ...base, row_fingerprint: hash(JSON.stringify(base)) };
}

async function createRun(source: string, rows: ReturnType<typeof stagedRow>[]) {
  const { data: role } = await server
    .from("roles")
    .select("id")
    .eq("code", "ADMIN")
    .single();
  const { data: approver } = await server
    .from("app_users")
    .select("employee_code")
    .eq("role_id", role!.id)
    .eq("is_active", true)
    .limit(1)
    .single();
  const { data: run, error: runError } = await server.rpc(
    "stage_sicar_catalog_run",
    {
      p_source_sha256: hash(source),
      p_source_file: `${source}.xlsx`,
      p_source_sheet: "Productos",
      p_report_sha256: hash(`report-${source}`),
      p_expected_rows: rows.length,
      p_barcode_symbology: "CODE128",
      p_barcode_test_reference: "Etiqueta física escaneada en prueba M9",
      p_approved_by_employee_code: approver!.employee_code,
    },
  );
  expect(runError).toBeNull();
  if (!run.already_applied) {
    const { error } = await server.rpc("stage_sicar_catalog_rows", {
      p_run_id: run.id,
      p_rows: rows,
    });
    expect(error).toBeNull();
  }
  return run;
}

async function inventorySnapshot() {
  const { data, error } = await server
    .from("inventory_by_location")
    .select("qty");
  expect(error).toBeNull();
  return {
    rows: data!.length,
    total: data!.reduce((sum, row) => sum + Number(row.qty), 0),
  };
}

describe.sequential("M9: sincronizador seguro de catálogo SICAR", () => {
  beforeAll(async () => {
    const { error } = await server.rpc("configure_sicar_catalog_staging", {
      p_project_ref: "zsezjtswqeijboezvado",
      p_confirmation: "ENABLE CATALOG ONLY",
    });
    expect(error).toBeNull();
  });

  it("sólo permite preparar la sincronización con service_role", async () => {
    const { error } = await anonymous.rpc("stage_sicar_catalog_run", {
      p_source_sha256: hash("anon"),
      p_source_file: "anon.xlsx",
      p_source_sheet: "Productos",
      p_report_sha256: hash("anon-report"),
      p_expected_rows: 1,
      p_barcode_symbology: "CODE128",
      p_barcode_test_reference: "Prueba física",
      p_approved_by_employee_code: "ADMIN0",
    });
    expect(error).not.toBeNull();
  });

  it("aplica catálogo una sola vez, conserva ceros y no toca inventario", async () => {
    const beforeInventory = await inventorySnapshot();
    const run = await createRun("m9-first", [
      stagedRow(2, `0${keyA}`),
      stagedRow(3, keyB),
    ]);
    const first = await server.rpc("apply_sicar_catalog_run", {
      p_run_id: run.id,
    });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({
      rows: 2,
      created: 2,
      inventory_rows_touched: 0,
      absent_products_deactivated: 0,
      already_applied: false,
    });

    const repeatedRun = await createRun("m9-first", [
      stagedRow(2, `0${keyA}`),
      stagedRow(3, keyB),
    ]);
    expect(repeatedRun.already_applied).toBe(true);
    const repeated = await server.rpc("apply_sicar_catalog_run", {
      p_run_id: run.id,
    });
    expect(repeated.error).toBeNull();
    expect(repeated.data.already_applied).toBe(true);
    const { data: variants } = await server
      .from("variants")
      .select("legacy_sicar_code")
      .in("legacy_sicar_code", [`0${keyA}`, keyB]);
    expect(variants).toHaveLength(2);
    expect(await inventorySnapshot()).toEqual(beforeInventory);
  });

  it("actualiza por identidad, preserva costo válido y no desactiva ausentes", async () => {
    const run = await createRun("m9-second", [
      stagedRow(2, `0${keyA}`, {
        description: "Producto SICAR actualizado",
        cost_cents: 0,
        price_cents: 27500,
      }),
    ]);
    const applied = await server.rpc("apply_sicar_catalog_run", {
      p_run_id: run.id,
    });
    expect(applied.error).toBeNull();
    expect(applied.data).toMatchObject({ updated: 1, zero_cost_preserved: 1 });
    const { data: updated } = await server
      .from("variants")
      .select("cost_cents, price_cents, products!inner(name)")
      .eq("legacy_sicar_code", `0${keyA}`)
      .single();
    expect(updated).toMatchObject({ cost_cents: 10000, price_cents: 27500 });
    expect((updated!.products as unknown as { name: string }).name).toBe(
      "Producto SICAR actualizado",
    );
    const { data: absent } = await server
      .from("variants")
      .select("is_active")
      .eq("legacy_sicar_code", keyB)
      .single();
    expect(absent!.is_active).toBe(true);
  });

  it("revierte todo el archivo cuando encuentra un conflicto reservado", async () => {
    const { data: category } = await server
      .from("categories")
      .select("id")
      .eq("name", "Accesorios")
      .single();
    const serial = `8${stamp.slice(-8)}`;
    const { data: product } = await server
      .from("products")
      .insert({ name: "Producto nativo M9", category_id: category!.id })
      .select("id")
      .single();
    const { data: variant } = await server
      .from("variants")
      .insert({
        product_id: product!.id,
        sku: luhn(serial),
        cost_cents: 10,
        price_cents: 20,
      })
      .select("id")
      .single();
    const reservedCode = ean13(`20${stamp.slice(-10)}`);
    await server.from("barcodes").insert({
      variant_id: variant!.id,
      code: reservedCode,
      symbology: "EAN13",
      source: "GENERATED",
      is_primary: true,
    });

    const atomicKey = `93${stamp.slice(-10)}`;
    const run = await createRun("m9-conflict", [
      stagedRow(2, atomicKey),
      stagedRow(3, reservedCode),
    ]);
    const applied = await server.rpc("apply_sicar_catalog_run", {
      p_run_id: run.id,
    });
    expect(applied.error?.message).toContain("SICAR_RESERVED_BARCODE_CONFLICT");
    const { data: rolledBack } = await server
      .from("variants")
      .select("id")
      .eq("legacy_sicar_code", atomicKey);
    expect(rolledBack).toEqual([]);
    const { data: nativeProduct } = await server
      .from("products")
      .select("name")
      .eq("id", product!.id)
      .single();
    expect(nativeProduct!.name).toBe("Producto nativo M9");
  });
});
