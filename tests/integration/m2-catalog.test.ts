import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const password = "Pruebas-M2-2026!";
const runCode = Date.now().toString().slice(-8);

type Fixture = { id: string; client: SupabaseClient };
const state = {
  admin: null as Fixture | null,
  manager: null as Fixture | null,
  cashier: null as Fixture | null,
  warehouse: null as Fixture | null,
  categoryId: "",
  colorIds: {} as Record<string, string>,
  sizeIds: [] as Array<{ id: string; value: string; display_order: number }>,
  productId: "",
  variantIds: [] as string[],
  skus: [] as string[],
  primaryBarcodes: [] as string[],
  extraSizeIds: [] as string[],
  importBrand: "",
};

function publicClient() {
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function ean13(payload: string) {
  expect(payload).toMatch(/^\d{12}$/);
  const sum = [...payload].reduce(
    (total, digit, index) =>
      total + Number(digit) * ((index + 1) % 2 === 0 ? 3 : 1),
    0,
  );
  return `${payload}${(10 - (sum % 10)) % 10}`;
}

function sku(payload: string) {
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

describe.sequential("M2: catálogo, variantes, códigos y RLS", () => {
  beforeAll(async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: roles } = await server.from("roles").select("id, code");
    const roleIds = Object.fromEntries(
      (roles ?? []).map((role) => [role.code, role.id]),
    );

    for (const definition of [
      { key: "admin", role: "ADMIN" },
      { key: "manager", role: "MANAGER" },
      { key: "cashier", role: "CASHIER" },
      { key: "warehouse", role: "WAREHOUSE" },
    ] as const) {
      const email = `m2-${definition.key}-${runCode}@vaquero.test`;
      const { data: authData, error: authError } =
        await server.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
      expect(authError).toBeNull();
      const id = authData.user!.id;
      const { error: profileError } = await server.from("app_users").insert({
        id,
        employee_code: `M2${definition.key.toUpperCase()}${runCode}`,
        full_name: `M2 ${definition.key}`,
        email,
        role_id: roleIds[definition.role],
      });
      expect(profileError).toBeNull();
      const client = publicClient();
      const { error: signInError } = await client.auth.signInWithPassword({
        email,
        password,
      });
      expect(signInError).toBeNull();
      state[definition.key] = { id, client };
    }

    const { data: category, error: categoryError } = await server
      .from("categories")
      .select("id")
      .eq("name", "Botas")
      .single();
    expect(categoryError).toBeNull();
    state.categoryId = category!.id;

    const { data: colors, error: colorError } = await server
      .from("attribute_values")
      .insert([
        { type_code: "COLOR", value: `Negro ${runCode}`, display_order: 10 },
        { type_code: "COLOR", value: `Café ${runCode}`, display_order: 20 },
      ])
      .select("id, value");
    expect(colorError).toBeNull();
    state.colorIds = Object.fromEntries(
      (colors ?? []).map((color) => [color.value, color.id]),
    );

    const { data: sizes, error: sizeError } = await server
      .from("attribute_values")
      .select("id, value, display_order")
      .eq("type_code", "TALLA")
      .eq("scale_code", "CALZADO_MX")
      .gte("display_order", 25)
      .lte("display_order", 28.5)
      .order("display_order")
      .limit(8);
    expect(sizeError).toBeNull();
    state.sizeIds = (sizes ?? []) as typeof state.sizeIds;
    expect(state.sizeIds).toHaveLength(8);

    const { data: extraSizes, error: extraSizesError } = await server
      .from("attribute_values")
      .select("id")
      .eq("type_code", "TALLA")
      .eq("scale_code", "CALZADO_MX")
      .in("value", ["29", "29.5"])
      .order("display_order");
    expect(extraSizesError).toBeNull();
    state.extraSizeIds = (extraSizes ?? []).map((size) => size.id);
    expect(state.extraSizeIds).toHaveLength(2);

    state.importBrand = `Marca carga ${runCode}`;
    const { error: brandError } = await server
      .from("brands")
      .insert({ name: state.importBrand });
    expect(brandError).toBeNull();
  }, 30_000);

  it("ordena las tallas por display_order y no alfabéticamente", () => {
    expect(state.sizeIds.map((size) => size.value)).toEqual([
      "25",
      "25.5",
      "26",
      "26.5",
      "27",
      "27.5",
      "28",
      "28.5",
    ]);
  });

  it("genera atómicamente 2 colores por 8 tallas con identidad automática", async () => {
    const variants = Object.entries(state.colorIds).flatMap(
      ([color, colorId]) =>
        state.sizeIds.map((size) => ({
          cost_cents: 120000,
          price_cents: 219900,
          attributes: { COLOR: colorId, TALLA: size.id },
          color,
        })),
    );
    const { data, error } = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: `Bota matriz ${runCode}`,
        p_category_id: state.categoryId,
        p_variants: variants,
      },
    );
    expect(error).toBeNull();
    expect(data.variant_count).toBe(16);
    state.productId = data.product_id;

    const result = await state.admin!.client.rpc("search_catalog", {
      p_query: `Bota matriz ${runCode}`,
      p_limit: 30,
    });
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(16);
    expect(
      result.data.every((variant: { primary_barcode: string }) =>
        /^20\d{11}$/.test(variant.primary_barcode),
      ),
    ).toBe(true);
    expect(
      new Set(result.data.map((variant: { sku: string }) => variant.sku)).size,
    ).toBe(16);
    expect(
      new Set(
        result.data.map(
          (variant: { primary_barcode: string }) => variant.primary_barcode,
        ),
      ).size,
    ).toBe(16);
    state.variantIds = result.data.map(
      (variant: { variant_id: string }) => variant.variant_id,
    );
    state.skus = result.data.map((variant: { sku: string }) => variant.sku);
    state.primaryBarcodes = result.data.map(
      (variant: { primary_barcode: string }) => variant.primary_barcode,
    );
  });

  it("encuentra la misma variante por código físico", async () => {
    const code = state.primaryBarcodes[0];
    const { data, error } = await state.cashier!.client.rpc("search_catalog", {
      p_query: code,
      p_limit: 10,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].primary_barcode).toBe(code);
  });

  it("adopta un código de proveedor y conserva el generado para escaneo", async () => {
    const supplierCode = ean13(`75${runCode.padStart(10, "0")}`);
    const originalCode = state.primaryBarcodes[0];
    const registered = await state.admin!.client.rpc(
      "register_variant_barcode",
      {
        p_variant_id: state.variantIds[0],
        p_code: supplierCode,
        p_symbology: "EAN13",
        p_source: "SUPPLIER",
      },
    );
    expect(registered.error).toBeNull();
    expect(registered.data).toMatchObject({
      code: supplierCode,
      reused: false,
      variant_id: state.variantIds[0],
    });

    const byNewCode = await state.cashier!.client.rpc("search_catalog", {
      p_query: supplierCode,
      p_limit: 10,
    });
    const byOldCode = await state.cashier!.client.rpc("search_catalog", {
      p_query: originalCode,
      p_limit: 10,
    });
    expect(byNewCode.error).toBeNull();
    expect(byOldCode.error).toBeNull();
    expect(byNewCode.data[0].variant_id).toBe(state.variantIds[0]);
    expect(byNewCode.data[0].primary_barcode).toBe(supplierCode);
    expect(byOldCode.data[0].variant_id).toBe(state.variantIds[0]);
    expect(byOldCode.data[0].primary_barcode).toBe(supplierCode);

    const repeated = await state.admin!.client.rpc("register_variant_barcode", {
      p_variant_id: state.variantIds[0],
      p_code: supplierCode,
      p_symbology: "EAN13",
      p_source: "SUPPLIER",
    });
    expect(repeated.error).toBeNull();
    expect(repeated.data.reused).toBe(true);
  });

  it("rechaza el mismo código de proveedor en otra talla", async () => {
    const supplierCode = ean13(`75${runCode.padStart(10, "0")}`);
    const { error } = await state.admin!.client.rpc(
      "register_variant_barcode",
      {
        p_variant_id: state.variantIds[1],
        p_code: supplierCode,
        p_symbology: "EAN13",
        p_source: "SUPPLIER",
      },
    );
    expect(error?.message).toContain("BARCODE_ALREADY_ASSIGNED");

    const unchanged = await state.cashier!.client.rpc("search_catalog", {
      p_query: state.primaryBarcodes[1],
      p_limit: 10,
    });
    expect(unchanged.data[0].primary_barcode).toBe(state.primaryBarcodes[1]);
  });

  it("reemite sin borrar los códigos físicos anteriores", async () => {
    const replacement = `RE-${runCode}-A`;
    const { error } = await state.admin!.client.rpc(
      "register_variant_barcode",
      {
        p_variant_id: state.variantIds[0],
        p_code: replacement,
        p_symbology: "CODE128",
        p_source: "MANUAL",
      },
    );
    expect(error).toBeNull();

    for (const code of [
      replacement,
      ean13(`75${runCode.padStart(10, "0")}`),
      state.primaryBarcodes[0],
    ]) {
      const result = await state.cashier!.client.rpc("search_catalog", {
        p_query: code,
        p_limit: 10,
      });
      expect(result.error).toBeNull();
      expect(result.data[0].variant_id).toBe(state.variantIds[0]);
      expect(result.data[0].primary_barcode).toBe(replacement);
    }
  });

  it("valida formato, origen y permisos antes de cambiar el primario", async () => {
    const validEan = ean13(`76${runCode.padStart(10, "0")}`);
    const invalidEan = `${validEan.slice(0, -1)}${(Number(validEan.at(-1)) + 1) % 10}`;
    const invalid = await state.admin!.client.rpc("register_variant_barcode", {
      p_variant_id: state.variantIds[1],
      p_code: invalidEan,
      p_symbology: "EAN13",
      p_source: "SUPPLIER",
    });
    expect(invalid.error?.message).toContain("INVALID_EAN13");

    const protectedSource = await state.admin!.client.rpc(
      "register_variant_barcode",
      {
        p_variant_id: state.variantIds[1],
        p_code: `SICAR-${runCode}`,
        p_symbology: "CODE128",
        p_source: "SICAR",
      },
    );
    expect(protectedSource.error?.message).toContain(
      "BARCODE_SOURCE_NOT_ALLOWED",
    );

    for (const prefix of ["20", "29"]) {
      const reserved = await state.admin!.client.rpc(
        "register_variant_barcode",
        {
          p_variant_id: state.variantIds[1],
          p_code: ean13(`${prefix}${runCode.padStart(10, "0")}`),
          p_symbology: "EAN13",
          p_source: "SUPPLIER",
        },
      );
      expect(reserved.error?.message).toContain("RESERVED_INTERNAL_PREFIX");
    }

    const outsideRange = await state.admin!.client.rpc(
      "register_variant_barcode",
      {
        p_variant_id: state.variantIds[2],
        p_code: ean13(`19${runCode.padStart(10, "0")}`),
        p_symbology: "EAN13",
        p_source: "SUPPLIER",
      },
    );
    expect(outsideRange.error).toBeNull();

    for (const client of [state.cashier!.client, state.warehouse!.client]) {
      const unauthorized = await client.rpc("register_variant_barcode", {
        p_variant_id: state.variantIds[1],
        p_code: `NO-${runCode}-${client === state.cashier!.client ? "C" : "W"}`,
        p_symbology: "CODE128",
        p_source: "MANUAL",
      });
      expect(unauthorized.error?.message).toContain("NOT_AUTHORIZED");
    }

    const unchanged = await state.cashier!.client.rpc("search_catalog", {
      p_query: state.primaryBarcodes[1],
      p_limit: 10,
    });
    expect(unchanged.data[0].primary_barcode).toBe(state.primaryBarcodes[1]);
  });

  it("agrega una talla sin cambiar las identidades existentes", async () => {
    const before = await state.admin!.client.rpc("search_catalog", {
      p_query: `Bota matriz ${runCode}`,
      p_limit: 30,
    });
    expect(before.error).toBeNull();
    const originalIdentities = new Map<
      string,
      { sku: string; barcode: string }
    >(
      before.data.map(
        (row: { variant_id: string; sku: string; primary_barcode: string }) => [
          row.variant_id,
          {
            sku: row.sku,
            barcode: row.primary_barcode,
          },
        ],
      ),
    );
    const [colorId] = Object.values(state.colorIds);
    const { data, error } = await state.warehouse!.client.rpc(
      "add_variants_to_product",
      {
        p_product_id: state.productId,
        p_variants: [
          {
            cost_cents: 120000,
            price_cents: 219900,
            attributes: {
              COLOR: colorId,
              TALLA: state.extraSizeIds[0],
            },
          },
        ],
      },
    );
    expect(error).toBeNull();
    expect(data.variant_count).toBe(1);

    const catalog = await state.admin!.client.rpc("search_catalog", {
      p_query: `Bota matriz ${runCode}`,
      p_limit: 30,
    });
    expect(catalog.error).toBeNull();
    expect(catalog.data).toHaveLength(17);
    for (const row of catalog.data) {
      const original = originalIdentities.get(row.variant_id);
      if (original) {
        expect(row.sku).toBe(original.sku);
        expect(row.primary_barcode).toBe(original.barcode);
      }
    }
  });

  it("rechaza agregar una combinación existente sin guardar parcialmente", async () => {
    const [colorId] = Object.values(state.colorIds);
    const { error } = await state.warehouse!.client.rpc(
      "add_variants_to_product",
      {
        p_product_id: state.productId,
        p_variants: [
          {
            cost_cents: 120000,
            price_cents: 219900,
            attributes: {
              COLOR: colorId,
              TALLA: state.sizeIds[0].id,
            },
          },
        ],
      },
    );
    expect(error?.message).toContain("DUPLICATE_VARIANT_ATTRIBUTES");

    const catalog = await state.admin!.client.rpc("search_catalog", {
      p_query: `Bota matriz ${runCode}`,
      p_limit: 30,
    });
    expect(catalog.data).toHaveLength(17);
  });

  it("serializa dos altas simultáneas de la misma combinación", async () => {
    const colorId = Object.values(state.colorIds)[1];
    const payload = {
      p_product_id: state.productId,
      p_variants: [
        {
          cost_cents: 120000,
          price_cents: 219900,
          attributes: {
            COLOR: colorId,
            TALLA: state.extraSizeIds[1],
          },
        },
      ],
    };
    const results = await Promise.all([
      state.warehouse!.client.rpc("add_variants_to_product", payload),
      state.admin!.client.rpc("add_variants_to_product", payload),
    ]);
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(
      results.filter((result) =>
        result.error?.message.includes("DUPLICATE_VARIANT_ATTRIBUTES"),
      ),
    ).toHaveLength(1);
  });

  it("no permite al cajero agregar variantes ni aceptar identidades manuales", async () => {
    const variant = {
      cost_cents: 100,
      price_cents: 200,
      attributes: { TALLA: state.extraSizeIds[1] },
    };
    const unauthorized = await state.cashier!.client.rpc(
      "add_variants_to_product",
      { p_product_id: state.productId, p_variants: [variant] },
    );
    expect(unauthorized.error?.message).toContain("NOT_AUTHORIZED");

    const manualIdentity = await state.warehouse!.client.rpc(
      "add_variants_to_product",
      {
        p_product_id: state.productId,
        p_variants: [{ ...variant, sku: `MANUAL-${runCode}` }],
      },
    );
    expect(manualIdentity.error?.message).toContain(
      "IDENTITY_FIELDS_NOT_ALLOWED",
    );
  });

  it("un SKU mal tecleado no encuentra otra variante", async () => {
    const sku = state.skus[0];
    expect(sku).toMatch(/^\d+-\d$/);
    const lastDigit = Number(sku.at(-1));
    const mistyped = `${sku.slice(0, -1)}${(lastDigit + 1) % 10}`;
    const { data, error } = await state.cashier!.client.rpc("search_catalog", {
      p_query: mistyped,
      p_limit: 10,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("dos altas simultáneas reciben identidades distintas", async () => {
    const names = [`Concurrente A ${runCode}`, `Concurrente B ${runCode}`];
    const results = await Promise.all(
      names.map((name) =>
        state.warehouse!.client.rpc("create_catalog_product", {
          p_name: name,
          p_category_id: state.categoryId,
          p_variants: [
            {
              cost_cents: 100,
              price_cents: 200,
              attributes: { TALLA: state.sizeIds[0].id },
            },
          ],
        }),
      ),
    );
    expect(results.every((result) => result.error === null)).toBe(true);

    const searches = await Promise.all(
      names.map((name) =>
        state.admin!.client.rpc("search_catalog", {
          p_query: name,
          p_limit: 10,
        }),
      ),
    );
    const codes = searches.flatMap((result) =>
      (result.data ?? []).map(
        (variant: { primary_barcode: string }) => variant.primary_barcode,
      ),
    );
    expect(new Set(codes).size).toBe(2);
  });

  it("oculta costos al cajero pero permite leer precio y atributos", async () => {
    const { data, error } = await state.cashier!.client.rpc("search_catalog", {
      p_query: `Bota matriz ${runCode}`,
      p_limit: 30,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(18);
    expect(
      data.every(
        (variant: { cost_cents: number | null }) => variant.cost_cents === null,
      ),
    ).toBe(true);
    expect(data[0].price_cents).toBe(219900);
    expect(data[0].attributes.TALLA).toBeTruthy();

    const direct = await state
      .cashier!.client.from("variants")
      .select("cost_cents");
    expect(direct.error).not.toBeNull();
  });

  it("rechaza identidades elegidas por el cliente y revierte el producto completo", async () => {
    const duplicateName = `Producto con identidad manual ${runCode}`;
    const { error } = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: duplicateName,
        p_category_id: state.categoryId,
        p_variants: [
          {
            sku: `M2-DUP-${runCode}`,
            cost_cents: 100,
            price_cents: 200,
            attributes: { TALLA: state.sizeIds[0].id },
          },
        ],
      },
    );
    expect(error?.message).toContain("IDENTITY_FIELDS_NOT_ALLOWED");

    const { data: products } = await state
      .admin!.client.from("products")
      .select("id")
      .eq("name", duplicateName);
    expect(products).toEqual([]);
  });

  it("impide cambiar códigos SICAR incluso con la clave de servidor", async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const legacyCode = `SICAR-${runCode}`;
    const prepareLegacy = await server
      .from("variants")
      .update({ legacy_sicar_code: legacyCode })
      .eq("id", state.variantIds[0]);
    expect(prepareLegacy.error).toBeNull();
    const prepareBarcode = await server.from("barcodes").insert({
      variant_id: state.variantIds[0],
      code: legacyCode,
      symbology: "LEGACY",
      source: "SICAR",
      is_primary: false,
    });
    expect(prepareBarcode.error).toBeNull();

    const legacy = await server
      .from("variants")
      .update({ legacy_sicar_code: `CAMBIADO-${runCode}` })
      .eq("id", state.variantIds[0]);
    expect(legacy.error?.message).toContain("LEGACY_CODE_IMMUTABLE");

    const barcode = await server
      .from("barcodes")
      .update({ code: `CAMBIADO-${runCode}` })
      .eq("code", legacyCode);
    expect(barcode.error?.message).toContain("SICAR_BARCODE_IMMUTABLE");
  });

  it("impide cambiar el SKU y el código generado", async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const sku = await server
      .from("variants")
      .update({ sku: `CAMBIADO-${runCode}` })
      .eq("id", state.variantIds[1]);
    expect(sku.error?.message).toContain("VARIANT_SKU_IMMUTABLE");

    const barcode = await server
      .from("barcodes")
      .update({ code: `CAMBIADO-GEN-${runCode}` })
      .eq("code", state.primaryBarcodes[1]);
    expect(barcode.error?.message).toContain("GENERATED_BARCODE_IMMUTABLE");
  });

  it("el cajero no puede crear productos ni cambiar precios", async () => {
    const create = await state.cashier!.client.rpc("create_catalog_product", {
      p_name: "No autorizado",
      p_category_id: state.categoryId,
      p_variants: [
        {
          cost_cents: 0,
          price_cents: 1,
        },
      ],
    });
    expect(create.error).not.toBeNull();

    const update = await state
      .cashier!.client.from("variants")
      .update({ price_cents: 1 })
      .eq("id", state.variantIds[0]);
    expect(update.error).not.toBeNull();
  });

  // Los campos de aterrizaje de la migración sólo los escribe el importador
  // de M9. Escritos desde el alta manual quedaban permanentes —son
  // inmutables por diseño— y podían tumbar la migración real con una
  // violación de unicidad imposible de corregir.
  it("no deja reservar un código heredado de SICAR desde el alta manual", async () => {
    const { error } = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: `Intento legacy ${runCode}`,
        p_category_id: state.categoryId,
        p_variants: [
          {
            cost_cents: 100,
            price_cents: 200,
            legacy_sicar_code: `SIC-${runCode}`,
          },
        ],
      },
    );
    expect(error?.message).toContain("IDENTITY_FIELDS_NOT_ALLOWED");
  });

  it("no deja fijar identificadores de WooCommerce desde el alta manual", async () => {
    const { error } = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: `Intento woo ${runCode}`,
        p_category_id: state.categoryId,
        p_variants: [
          {
            cost_cents: 100,
            price_cents: 200,
            woocommerce_product_id: 99,
          },
        ],
      },
    );
    expect(error?.message).toContain("IDENTITY_FIELDS_NOT_ALLOWED");
  });

  it("no deja marcar un código de barras como de SICAR", async () => {
    const { error } = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: `Intento origen ${runCode}`,
        p_category_id: state.categoryId,
        p_variants: [
          {
            cost_cents: 100,
            price_cents: 200,
            barcode_source: "SICAR",
          },
        ],
      },
    );
    expect(error?.message).toContain("IDENTITY_FIELDS_NOT_ALLOWED");
  });

  it("encuentra un producto acentuado se escriba con acento o sin él", async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await server
      .from("products")
      .update({ name: `Botín Acentuado ${runCode}` })
      .eq("id", state.productId);

    const conAcento = await state.admin!.client.rpc("search_catalog", {
      p_query: "botín acentuado",
    });
    const sinAcento = await state.admin!.client.rpc("search_catalog", {
      p_query: "botin acentuado",
    });

    expect(conAcento.error).toBeNull();
    expect((conAcento.data ?? []).length).toBeGreaterThan(0);
    expect((sinAcento.data ?? []).length).toBe((conAcento.data ?? []).length);
  });

  it("no trata los comodines del buscador como comodines", async () => {
    const { data, error } = await state.admin!.client.rpc("search_catalog", {
      p_query: "%",
    });
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("rechaza dos variantes con la misma talla y el mismo color", async () => {
    // Antes del generador esto chocaba solo, porque quien llamaba mandaba el
    // código de barras y el segundo renglón violaba la unicidad. Al generar
    // ahora una identidad nueva por renglón, los duplicados pasarían sin ruido
    // y el mismo artículo físico quedaría con dos SKU y la existencia partida.
    const repeatedName = `Bota combinacion repetida ${runCode}`;
    const [colorId] = Object.values(state.colorIds);
    const variant = {
      cost_cents: 100,
      price_cents: 200,
      attributes: { COLOR: colorId, TALLA: state.sizeIds[0].id },
    };
    const { error } = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: repeatedName,
        p_category_id: state.categoryId,
        p_variants: [variant, variant],
      },
    );
    expect(error?.message).toContain("DUPLICATE_VARIANT_ATTRIBUTES");

    const { data: products } = await state
      .admin!.client.from("products")
      .select("id")
      .eq("name", repeatedName);
    expect(products).toEqual([]);
  });

  it("acepta un solo artículo sin atributos, pero no dos", async () => {
    // Una hebilla o un accesorio sin variaciones es legítimo: la firma vacía
    // vale una vez por producto, no dos.
    const singleName = `Accesorio unico ${runCode}`;
    const single = await state.warehouse!.client.rpc("create_catalog_product", {
      p_name: singleName,
      p_category_id: state.categoryId,
      p_variants: [{ cost_cents: 100, price_cents: 200 }],
    });
    expect(single.error).toBeNull();

    const doubleName = `Accesorio duplicado ${runCode}`;
    const doubled = await state.warehouse!.client.rpc(
      "create_catalog_product",
      {
        p_name: doubleName,
        p_category_id: state.categoryId,
        p_variants: [
          { cost_cents: 100, price_cents: 200 },
          { cost_cents: 100, price_cents: 200 },
        ],
      },
    );
    expect(doubled.error?.message).toContain("DUPLICATE_VARIANT_ATTRIBUTES");
  });

  it("edita datos, costo, estado y precio sin tocar la identidad", async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: before } = await server
      .from("variants")
      .select(
        "sku, legacy_sicar_code, woocommerce_product_id, woocommerce_variation_id",
      )
      .eq("id", state.variantIds[0])
      .single();
    const { data: primaryBefore } = await server
      .from("barcodes")
      .select("code")
      .eq("variant_id", state.variantIds[0])
      .eq("is_primary", true)
      .single();

    const product = await state.manager!.client.rpc("update_catalog_product", {
      p_product_id: state.productId,
      p_name: `Producto editado ${runCode}`,
      p_category_id: state.categoryId,
      p_brand_name: "Marca editada",
      p_description: "Descripción aprobada en la edición segura",
      p_is_active: true,
    });
    expect(product.error).toBeNull();

    const variant = await state.manager!.client.rpc("update_catalog_variant", {
      p_variant_id: state.variantIds[0],
      p_cost_cents: 135000,
      p_is_active: false,
    });
    expect(variant.error).toBeNull();

    const price = await state.manager!.client.rpc(
      "update_catalog_variant_price",
      { p_variant_id: state.variantIds[0], p_price_cents: 239900 },
    );
    expect(price.error).toBeNull();

    const { data: after } = await server
      .from("variants")
      .select(
        "sku, legacy_sicar_code, woocommerce_product_id, woocommerce_variation_id, cost_cents, price_cents, is_active",
      )
      .eq("id", state.variantIds[0])
      .single();
    const { data: primaryAfter } = await server
      .from("barcodes")
      .select("code")
      .eq("variant_id", state.variantIds[0])
      .eq("is_primary", true)
      .single();

    expect(after).toMatchObject({
      ...before,
      cost_cents: 135000,
      price_cents: 239900,
      is_active: false,
    });
    expect(primaryAfter?.code).toBe(primaryBefore?.code);

    const { data: audit } = await server
      .from("audit_log")
      .select("actor_user_id, before_data, after_data")
      .eq("entity_type", "variants")
      .eq("entity_id", state.variantIds[0])
      .eq("actor_user_id", state.manager!.id);
    expect(audit?.length).toBeGreaterThanOrEqual(2);
    expect(
      audit?.some(
        (entry) =>
          entry.before_data.price_cents !== entry.after_data.price_cents,
      ),
    ).toBe(true);
  });

  it("rechaza la edición a cajero, almacén y sesión anónima", async () => {
    for (const fixture of [state.cashier!, state.warehouse!]) {
      const product = await fixture.client.rpc("update_catalog_product", {
        p_product_id: state.productId,
        p_name: "Cambio no autorizado",
        p_category_id: state.categoryId,
      });
      expect(product.error).not.toBeNull();

      const price = await fixture.client.rpc("update_catalog_variant_price", {
        p_variant_id: state.variantIds[0],
        p_price_cents: 1,
      });
      expect(price.error).not.toBeNull();
    }

    const anonymous = await publicClient().rpc("update_catalog_product", {
      p_product_id: state.productId,
      p_name: "Anónimo",
      p_category_id: state.categoryId,
    });
    expect(anonymous.error).not.toBeNull();
  });

  it("corre en seco, explica datos sucios y no escribe nada", async () => {
    const productName = `Carga inválida ${runCode}`;
    const duplicatedCode = `DUP-CARGA-${runCode}`;
    const rows = [
      {
        product_name: productName,
        category: "Botas",
        brand: "Marca que no existe",
        description: "",
        color: `Negro ${runCode}`,
        size: "99",
        cost: "mil",
        price: "2199",
        barcode: duplicatedCode,
        barcode_was_numeric: false,
      },
      {
        product_name: productName,
        category: "Botas",
        brand: "Marca que no existe",
        description: "",
        color: `Negro ${runCode}`,
        size: "25",
        cost: "1200",
        price: "2199",
        barcode: duplicatedCode,
        barcode_was_numeric: false,
      },
      {
        product_name: `${productName} dos`,
        category: "Botas",
        brand: state.importBrand,
        description: "",
        color: `Café ${runCode}`,
        size: "25.5",
        cost: "1200",
        price: "2199",
        barcode: "012345678901",
        barcode_was_numeric: true,
      },
    ];
    const { data, error } = await state.warehouse!.client.rpc(
      "validate_catalog_import",
      { p_rows: rows },
    );
    expect(error).toBeNull();
    const codes = new Set(
      data.errors.map((issue: { code: string }) => issue.code),
    );
    for (const code of [
      "MARCA_INEXISTENTE",
      "TALLA_FUERA_DE_ESCALA",
      "COSTO_NO_NUMERICO",
      "CODIGO_DUPLICADO_ARCHIVO",
      "CODIGO_CONVERTIDO_A_NUMERO",
    ]) {
      expect(codes.has(code)).toBe(true);
    }
    expect(data.valid_rows).toBe(0);

    const { data: products } = await state
      .admin!.client.from("products")
      .select("id")
      .in("name", [productName, `${productName} dos`]);
    expect(products).toEqual([]);
  });

  it("importa todos los productos o ninguno y conserva código interno", async () => {
    const productName = `Carga correcta ${runCode}`;
    const rows = state.sizeIds.slice(0, 2).map((size, index) => ({
      product_name: productName,
      category: "Botas",
      brand: state.importBrand,
      description: "Alta desde plantilla propia",
      color: `Negro ${runCode}`,
      size: size.value,
      cost: "1200.50",
      price: "2199",
      barcode: `PROV-${runCode}-${index + 1}`,
      barcode_was_numeric: false,
    }));

    const preview = await state.warehouse!.client.rpc(
      "validate_catalog_import",
      { p_rows: rows },
    );
    expect(preview.error).toBeNull();
    expect(preview.data).toMatchObject({
      total_rows: 2,
      valid_rows: 2,
      error_count: 0,
    });
    const before = await state
      .admin!.client.from("products")
      .select("id")
      .eq("name", productName);
    expect(before.data).toEqual([]);

    const committed = await state.warehouse!.client.rpc(
      "commit_catalog_import",
      { p_rows: rows },
    );
    expect(committed.error).toBeNull();
    expect(committed.data).toEqual({ product_count: 1, variant_count: 2 });

    const catalog = await state.admin!.client.rpc("search_catalog", {
      p_query: productName,
      p_limit: 10,
    });
    expect(catalog.error).toBeNull();
    expect(catalog.data).toHaveLength(2);
    expect(
      catalog.data.map(
        (row: { primary_barcode: string }) => row.primary_barcode,
      ),
    ).toEqual(expect.arrayContaining(rows.map((row) => row.barcode)));

    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const variantIds = catalog.data.map(
      (row: { variant_id: string }) => row.variant_id,
    );
    const { data: barcodes } = await server
      .from("barcodes")
      .select("variant_id, source, is_primary")
      .in("variant_id", variantIds);
    expect(barcodes).toHaveLength(4);
    expect(
      barcodes?.filter((barcode) => barcode.source === "GENERATED"),
    ).toHaveLength(2);
    expect(
      barcodes?.filter(
        (barcode) => barcode.source === "SUPPLIER" && barcode.is_primary,
      ),
    ).toHaveLength(2);

    const { data: audit } = await server
      .from("audit_log")
      .select("actor_user_id, metadata")
      .eq("action", "catalog.import")
      .eq("actor_user_id", state.warehouse!.id);
    expect(audit?.some((entry) => entry.metadata.variant_count === 2)).toBe(
      true,
    );
  });

  it("vuelve a validar al confirmar y bloquea roles sin permiso", async () => {
    const productName = `Carga atómica ${runCode}`;
    const invalidRows = [
      {
        product_name: productName,
        category: "Botas",
        brand: state.importBrand,
        description: "",
        color: `Negro ${runCode}`,
        size: state.sizeIds[0].value,
        cost: "100",
        price: "200",
        barcode: `PROV-${runCode}-1`,
        barcode_was_numeric: false,
      },
    ];
    const commit = await state.warehouse!.client.rpc("commit_catalog_import", {
      p_rows: invalidRows,
    });
    expect(commit.error?.message).toContain("IMPORT_VALIDATION_FAILED");
    const { data: products } = await state
      .admin!.client.from("products")
      .select("id")
      .eq("name", productName);
    expect(products).toEqual([]);

    for (const client of [state.cashier!.client, publicClient()]) {
      const denied = await client.rpc("validate_catalog_import", {
        p_rows: invalidRows,
      });
      expect(denied.error?.message).toMatch(
        /NOT_AUTHORIZED|permission denied for function/,
      );
    }
  });

  it("cambia 300 precios atómicamente y genera 300 eventos de auditoría", async () => {
    const server = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: products, error: productsError } = await server
      .from("products")
      .insert(
        Array.from({ length: 300 }, (_, index) => ({
          name: `Lote precio ${runCode}-${index + 1}`,
          category_id: state.categoryId,
        })),
      )
      .select("id");
    expect(productsError).toBeNull();
    expect(products).toHaveLength(300);

    const { data: variants, error: variantsError } = await server
      .from("variants")
      .insert(
        products!.map((product, index) => ({
          product_id: product.id,
          sku: sku(`9${runCode}${String(index + 1).padStart(3, "0")}`),
          cost_cents: 5000,
          price_cents: 10000,
        })),
      )
      .select("id");
    expect(variantsError).toBeNull();
    expect(variants).toHaveLength(300);

    const changedAt = new Date().toISOString();
    const changes = variants!.map((variant) => ({
      variant_id: variant.id,
      expected_price_cents: 10000,
      new_price_cents: 12500,
    }));
    const changed = await state.admin!.client.rpc(
      "bulk_update_variant_prices",
      { p_changes: changes },
    );
    expect(changed.error).toBeNull();
    expect(changed.data.changed_count).toBe(300);

    const { data: audit, error: auditError } = await server
      .from("audit_log")
      .select("entity_id, before_data, after_data")
      .eq("action", "variants.update")
      .eq("actor_user_id", state.admin!.id)
      .gte("occurred_at", changedAt)
      .limit(400);
    expect(auditError).toBeNull();
    const ids = new Set(variants!.map((variant) => variant.id));
    const batchAudit = (audit ?? []).filter((entry) =>
      ids.has(entry.entity_id),
    );
    expect(batchAudit).toHaveLength(300);
    expect(
      batchAudit.every(
        (entry) =>
          entry.before_data.price_cents === 10000 &&
          entry.after_data.price_cents === 12500,
      ),
    ).toBe(true);

    const denied = await state.cashier!.client.rpc(
      "bulk_update_variant_prices",
      { p_changes: [changes[0]] },
    );
    expect(denied.error?.message).toContain("NOT_AUTHORIZED");
  }, 30_000);

  it("rechaza una vista previa de precio vencida sin modificar el lote", async () => {
    const variantIds = state.variantIds.slice(0, 2);
    const stale = await state.admin!.client.rpc("bulk_update_variant_prices", {
      p_changes: variantIds.map((variantId) => ({
        variant_id: variantId,
        expected_price_cents: 1,
        new_price_cents: 250000,
      })),
    });
    expect(stale.error?.message).toContain("STALE_PRICE_BATCH");
    const catalog = await state.admin!.client.rpc("search_catalog", {
      p_query: `Bota matriz ${runCode}`,
      p_limit: 30,
    });
    expect(
      catalog.data
        .filter((variant: { variant_id: string }) =>
          variantIds.includes(variant.variant_id),
        )
        .every(
          (variant: { price_cents: number }) => variant.price_cents === 219900,
        ),
    ).toBe(true);
  });

  it("da de baja un lote sin borrar identidad y rechaza al cajero", async () => {
    const variantIds = state.variantIds.slice(0, 2);
    const restored = await state.manager!.client.rpc(
      "bulk_update_variant_status",
      { p_variant_ids: variantIds, p_is_active: true },
    );
    expect(restored.error).toBeNull();

    const changed = await state.manager!.client.rpc(
      "bulk_update_variant_status",
      { p_variant_ids: variantIds, p_is_active: false },
    );
    expect(changed.error).toBeNull();
    expect(changed.data.changed_count).toBe(2);

    const catalog = await state.admin!.client.rpc("search_catalog", {
      p_query: `Bota matriz ${runCode}`,
      p_limit: 30,
    });
    const inactive = catalog.data.filter((variant: { variant_id: string }) =>
      variantIds.includes(variant.variant_id),
    );
    expect(
      inactive.every((variant: { is_active: boolean }) => !variant.is_active),
    ).toBe(true);
    expect(
      inactive.every((variant: { primary_barcode: string }) =>
        Boolean(variant.primary_barcode),
      ),
    ).toBe(true);

    const denied = await state.cashier!.client.rpc(
      "bulk_update_variant_status",
      { p_variant_ids: variantIds, p_is_active: true },
    );
    expect(denied.error?.message).toContain("NOT_AUTHORIZED");
  });

  it("guarda plantillas con permiso y conserva lectura de mínimo privilegio", async () => {
    const name = `Etiqueta prueba ${runCode}`;
    const saved = await state.manager!.client.rpc("save_label_template", {
      p_id: null,
      p_name: name,
      p_width_mm: 60,
      p_height_mm: 35,
      p_layout: "PRODUCT_FOCUS",
      p_show_logo: true,
      p_show_product_name: true,
      p_show_brand: true,
      p_show_size: true,
      p_show_color: true,
      p_show_price: false,
      p_show_sku: true,
      p_show_barcode: true,
      p_show_code: true,
      p_is_default: false,
      p_is_active: true,
    });
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject({ name, layout: "PRODUCT_FOCUS" });

    const readable = await state
      .cashier!.client.from("label_templates")
      .select("name")
      .eq("name", name);
    expect(readable.error).toBeNull();
    expect(readable.data).toHaveLength(1);

    const denied = await state.cashier!.client.rpc("save_label_template", {
      p_id: null,
      p_name: `${name} no`,
      p_width_mm: 50,
      p_height_mm: 30,
      p_layout: "BALANCED",
      p_show_logo: true,
      p_show_product_name: true,
      p_show_brand: false,
      p_show_size: true,
      p_show_color: true,
      p_show_price: true,
      p_show_sku: false,
      p_show_barcode: true,
      p_show_code: true,
      p_is_default: false,
      p_is_active: true,
    });
    expect(denied.error?.message).toContain("NOT_AUTHORIZED");
  });
});
